#include "ble_manager.h"
#include "objc_cpp.h"
#include "Peripheral.h"

#import <Foundation/Foundation.h>

@interface BLEManager ()
- (void)updateMtuForPeripheral:(CBPeripheral*) peripheral;
@end

@implementation BLEManager

- (instancetype)init: (const Napi::Value&) receiver with: (const Napi::Function&) callback
{
    if (self = [super init]) {
        pendingRead = false;
        // wrap cb before creating the CentralManager as it may call didUpdateState immediately
        self->emit.Wrap(receiver, callback);
        self.dispatchQueue = dispatch_queue_create("CBqueue", 0);
        self.centralManager = [[CBCentralManager alloc] initWithDelegate:self queue:self.dispatchQueue];
        self.discovered = [NSMutableSet set];
        self.peripherals = [NSMutableDictionary dictionaryWithCapacity:10];
        self.mtus = [NSMutableDictionary dictionaryWithCapacity:10];
        
        // Set up periodic state checking to handle sleep/wake cycles using GCD timer
        // Check every 2 seconds for state changes on the same dispatch queue
        self.stateCheckTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, self.dispatchQueue);
        if (self.stateCheckTimer) {
            dispatch_source_set_timer(self.stateCheckTimer, 
                                    dispatch_time(DISPATCH_TIME_NOW, 2.0 * NSEC_PER_SEC),
                                    2.0 * NSEC_PER_SEC, 
                                    0.1 * NSEC_PER_SEC); // 100ms leeway
            __weak typeof(self) weakSelf = self;
            dispatch_source_set_event_handler(self.stateCheckTimer, ^{
                __strong typeof(weakSelf) strongSelf = weakSelf;
                if (strongSelf) {
                    CBManagerState currentState = strongSelf.centralManager.state;
                    if (currentState != strongSelf.lastState) {
                        [strongSelf centralManagerDidUpdateState:strongSelf.centralManager];
                    }
                }
            });
            dispatch_resume(self.stateCheckTimer);
        }
    }
    return self;
}

- (void)updateMtuForPeripheral:(CBPeripheral*) peripheral {
    NSUInteger mtu = [peripheral maximumWriteValueLengthForType:CBCharacteristicWriteWithoutResponse];
    NSNumber *mtuNumber = [self.mtus objectForKey: peripheral.identifier];
    if (!mtuNumber || [mtuNumber unsignedIntegerValue] != mtu) {
        emit.MTU(getUuid(peripheral), mtu);
        [self.mtus setObject:[NSNumber numberWithInt:mtu] forKey: peripheral.identifier];
    }
}

- (void)centralManagerDidUpdateState:(CBCentralManager *)central 
{
    if (central.state != self.lastState && self.lastState == CBManagerStatePoweredOff && central.state == CBManagerStatePoweredOn) {
        [self.peripherals enumerateKeysAndObjectsUsingBlock:^(id key, CBPeripheral* peripheral, BOOL *stop) {
            if (peripheral.state == CBPeripheralStateConnected) {
                [self.centralManager cancelPeripheralConnection:peripheral];
            }
        }];
    }

    self.lastState = central.state;
    auto state = stateToString(central.state);
    emit.RadioState(state);
}

- (void)scan:(NSArray<NSString*> *)serviceUUIDs allowDuplicates:(BOOL)allowDuplicates {
    [self.discovered removeAllObjects];
    NSMutableArray* advServicesUuid = [NSMutableArray arrayWithCapacity:[serviceUUIDs count]];
    [serviceUUIDs enumerateObjectsUsingBlock:^(id obj, NSUInteger idx, BOOL *stop) {
        [advServicesUuid addObject:[CBUUID UUIDWithString:obj]];
    }];
    
    NSDictionary *options = @{CBCentralManagerScanOptionAllowDuplicatesKey:[NSNumber numberWithBool:allowDuplicates]};
    [self.centralManager scanForPeripheralsWithServices:advServicesUuid options:options];
    emit.ScanState(true);
}

- (void)stopScan 
{
    [self.centralManager stopScan];
    emit.ScanState(false);
}

- (void) centralManager:(CBCentralManager *)central 
  didDiscoverPeripheral:(CBPeripheral *)peripheral 
      advertisementData:(NSDictionary<NSString *,id> *)advertisementData 
                   RSSI:(NSNumber *)RSSI 
{
    std::string uuid = getUuid(peripheral);
    [self.discovered addObject:getNSUuid(peripheral)];

    Peripheral p;
    p.address = getAddress(uuid, &p.addressType);
    
    IF(NSNumber*, connect, [advertisementData objectForKey:CBAdvertisementDataIsConnectable]) {
        p.connectable = [connect boolValue];
    }
    
    IF(NSString*, dataLocalName, [advertisementData objectForKey:CBAdvertisementDataLocalNameKey]) {
        p.name = std::string([dataLocalName UTF8String]);
    }
    
    if (!p.name) {
        IF(NSString*, name, [peripheral name]) {
            p.name = std::string([name UTF8String]);
        }
    }
    
    IF(NSNumber*, txLevel, [advertisementData objectForKey:CBAdvertisementDataTxPowerLevelKey]) {
        p.txPowerLevel = [txLevel intValue];
    }
    
    IF(NSData*, data, [advertisementData objectForKey:CBAdvertisementDataManufacturerDataKey]) {
        const UInt8* bytes = (UInt8 *)[data bytes];
        Data manufacturerData;
        manufacturerData.assign(bytes, bytes + [data length]);
        p.manufacturerData = manufacturerData;
    }
    
    IF(NSDictionary*, dictionary, [advertisementData objectForKey:CBAdvertisementDataServiceDataKey]) {
        std::vector<std::pair<std::string, Data>> serviceData;
        for (CBUUID* key in dictionary) {
            IF(NSData*, value, dictionary[key]) {
                auto serviceUuid = [[key UUIDString] UTF8String];
                Data sData;
                const UInt8* bytes = (UInt8 *)[value bytes];
                sData.assign(bytes, bytes + [value length]);
                serviceData.push_back(std::make_pair(serviceUuid, sData));
            }
        }
        if (!serviceData.empty()) {
            p.serviceData = serviceData;
        }
    }
    
    IF(NSArray*, services, [advertisementData objectForKey:CBAdvertisementDataServiceUUIDsKey]) {
        std::vector<std::string> serviceUuids;
        for (CBUUID* service in services) {
            serviceUuids.push_back([[service UUIDString] UTF8String]);
        }
        if (!serviceUuids.empty()) {
            p.serviceUuids = serviceUuids;
        }
    }

    int rssi = [RSSI intValue];
    emit.Scan(uuid, rssi, p);
}

- (BOOL)connect:(NSString*) uuid {
    CBPeripheral *peripheral = [self.peripherals objectForKey:uuid];
    if(!peripheral) {
        NSUUID *identifier = [[NSUUID alloc] initWithUUIDString:uuid];
        if (!identifier) {
            return NO;
        }
        NSArray* peripherals = [self.centralManager retrievePeripheralsWithIdentifiers:@[identifier]];
        peripheral = [peripherals firstObject];
        if(peripheral) {
            peripheral.delegate = self;
            [self.peripherals setObject:peripheral forKey:uuid];
        } else {
            return NO;
        }
    }
    NSDictionary* options = @{CBConnectPeripheralOptionNotifyOnDisconnectionKey: [NSNumber numberWithBool:YES]};
    [self.centralManager connectPeripheral:peripheral options:options];
    return YES;
}

- (void) centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
    // Check if peripheral was known
    if ([self.discovered containsObject:getNSUuid(peripheral)] == false) {
        // The peripheral was connected without being discovered by this app instance
        // Optionally simulate discovery using dummy or last known advertisement data and RSSI
        NSDictionary<NSString *, id> *advertisementData = @{ }; // Placeholder, use actual last known data if available
        NSNumber *RSSI = @127; // Placeholder RSSI, use actual last known value if available

        // Simulate discovery handling
        [self centralManager:central didDiscoverPeripheral:peripheral advertisementData:advertisementData RSSI:RSSI];
    }
    
    std::string uuid = getUuid(peripheral);
    emit.Connected(uuid, "");
    [self updateMtuForPeripheral:peripheral];
    
}

- (void) centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    [self.peripherals removeObjectForKey:getNSUuid(peripheral)];
    std::string uuid = getUuid(peripheral);
    emit.Connected(uuid, "connection failed");
}

- (BOOL)disconnect:(NSString*) uuid {
    IF(CBPeripheral*, peripheral, [self.peripherals objectForKey:uuid]) {
        [self.centralManager cancelPeripheralConnection:peripheral];
        return YES;
    }
    return NO;
}

-(void) centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    std::string uuid = getUuid(peripheral);
    [self.peripherals removeObjectForKey:getNSUuid(peripheral)];
    emit.Disconnected(uuid);
}

- (BOOL)updateRSSI:(NSString*) uuid {
    IF(CBPeripheral*, peripheral, [self.peripherals objectForKey:uuid]) {
        [peripheral readRSSI];
        return YES;
    }
    return NO;
}

- (void) peripheral:(CBPeripheral *) peripheral 
        didReadRSSI:(NSNumber *) RSSI 
              error:(NSError *) error
{
    std::string uuid = getUuid(peripheral);
    int16_t rssi = [RSSI intValue];
    emit.RSSI(uuid, rssi, error ? error.localizedDescription.UTF8String : "");
}

#pragma mark - Services

- (BOOL)discoverServices:(NSString*) uuid serviceUuids:(NSArray<NSString*>*) services {
    IF(CBPeripheral*, peripheral, [self.peripherals objectForKey:uuid]) {
        NSMutableArray* servicesUuid = nil;
        if(services) {
            servicesUuid = [NSMutableArray arrayWithCapacity:[services count]];
            [services enumerateObjectsUsingBlock:^(id obj, NSUInteger idx, BOOL *stop) {
                [servicesUuid addObject:[CBUUID UUIDWithString:obj]];
            }];
        }
        [peripheral discoverServices:servicesUuid];
        return YES;
    }
    return NO;
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {
    std::string uuid = getUuid(peripheral);
    std::vector<std::string> services = getServices(peripheral.services);
    [self updateMtuForPeripheral:peripheral];
    emit.ServicesDiscovered(uuid, services, error ? error.localizedDescription.UTF8String : "");
}

- (BOOL)discoverIncludedServices:(NSString*) uuid forService:(NSString*) serviceUuid services:(NSArray<NSString*>*) serviceUuids {
    IF(CBPeripheral*, peripheral, [self.peripherals objectForKey:uuid]) {
        IF(CBService*, service, [self getService:peripheral service:serviceUuid]) {
            NSMutableArray* includedServices = nil;
            if(serviceUuids) {
                includedServices = [NSMutableArray arrayWithCapacity:[serviceUuids count]];
                [serviceUuids enumerateObjectsUsingBlock:^(id obj, NSUInteger idx, BOOL *stop) {
                    [includedServices addObject:[CBUUID UUIDWithString:obj]];
                }];
            }
            [peripheral discoverIncludedServices:includedServices forService:service];
            return YES;
        }
    }
    return NO;
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverIncludedServicesForService:(CBService *)service error:(NSError *)error {
    std::string uuid = getUuid(peripheral);
    auto serviceUuid = [[service.UUID UUIDString] UTF8String];
    std::vector<std::string> services = getServices(service.includedServices);
    emit.IncludedServicesDiscovered(uuid, serviceUuid, services, error ? error.localizedDescription.UTF8String : "");
}

#pragma mark - Characteristics

- (BOOL)discoverCharacteristics:(NSString*) uuid forService:(NSString*) serviceUuid characteristics:(NSArray<NSString*>*) characteristics {
    IF(CBPeripheral *, peripheral, [self.peripherals objectForKey:uuid]) {
        IF(CBService*, service, [self getService:peripheral service:serviceUuid]) {
            NSMutableArray* characteristicsUuid = nil;
            if([characteristics count] > 0) {
                characteristicsUuid = [NSMutableArray arrayWithCapacity:[characteristics count]];
                [characteristics enumerateObjectsUsingBlock:^(id obj, NSUInteger idx, BOOL *stop) {
                    [characteristicsUuid addObject:[CBUUID UUIDWithString:obj]];
                }];
            }
            [peripheral discoverCharacteristics:characteristicsUuid forService:service];
            return YES;
        }
    }
    return NO;
}

-(void) peripheral:(CBPeripheral *)peripheral didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error {
    std::string uuid = getUuid(peripheral);
    std::string serviceUuid = std::string([service.UUID.UUIDString UTF8String]);
    auto characteristics = getCharacteristics(service.characteristics);
    [self updateMtuForPeripheral:peripheral];
    emit.CharacteristicsDiscovered(uuid, serviceUuid, characteristics, error ? error.localizedDescription.UTF8String : "");
}

- (BOOL)read:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid {
    IF(CBPeripheral *, peripheral, [self.peripherals objectForKey:uuid]) {
        IF(CBCharacteristic*, characteristic, [self getCharacteristic:peripheral service:serviceUuid characteristic:characteristicUuid]) {
            pendingRead = true;
            [peripheral readValueForCharacteristic:characteristic];
            return YES;
        }
    }
    return NO;
}

- (void) peripheral:(CBPeripheral *)peripheral didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    std::string uuid = getUuid(peripheral);
    std::string serviceUuid = [characteristic.service.UUID.UUIDString UTF8String];
    std::string characteristicUuid = [characteristic.UUID.UUIDString UTF8String];
    const UInt8* bytes = (UInt8 *)[characteristic.value bytes];
    Data data;
    data.assign(bytes, bytes+[characteristic.value length]);
    bool isNotification = !pendingRead && characteristic.isNotifying;
    pendingRead = false;
    emit.Read(uuid, serviceUuid, characteristicUuid, data, isNotification, error ? error.localizedDescription.UTF8String : "");
}

- (BOOL)write:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid data:(NSData*) data withoutResponse:(BOOL)withoutResponse {
    IF(CBPeripheral *, peripheral, [self.peripherals objectForKey:uuid]) {
        IF(CBCharacteristic*, characteristic, [self getCharacteristic:peripheral service:serviceUuid characteristic:characteristicUuid]) {
            CBCharacteristicWriteType type = withoutResponse ? CBCharacteristicWriteWithoutResponse : CBCharacteristicWriteWithResponse;
            [peripheral writeValue:data forCharacteristic:characteristic type:type];
            if (withoutResponse) {
                emit.Write([uuid UTF8String], [serviceUuid UTF8String], [characteristicUuid UTF8String]);
            }
            return YES;
        }
    }
    return NO;
}

-(void) peripheral:(CBPeripheral *)peripheral didWriteValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    std::string uuid = getUuid(peripheral);
    std::string serviceUuid = [characteristic.service.UUID.UUIDString UTF8String];
    std::string characteristicUuid = [characteristic.UUID.UUIDString UTF8String];
    emit.Write(uuid, serviceUuid, characteristicUuid, error ? error.localizedDescription.UTF8String : "");
}

- (BOOL)notify:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid on:(BOOL)on {
    IF(CBPeripheral *, peripheral, [self.peripherals objectForKey:uuid]) {
        IF(CBCharacteristic*, characteristic, [self getCharacteristic:peripheral service:serviceUuid characteristic:characteristicUuid]) {
            [peripheral setNotifyValue:on forCharacteristic:characteristic];
            return YES;
        }
    }
    return NO;
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    std::string uuid = getUuid(peripheral);
    std::string serviceUuid = [characteristic.service.UUID.UUIDString UTF8String];
    std::string characteristicUuid = [characteristic.UUID.UUIDString UTF8String];
    emit.Notify(uuid, serviceUuid, characteristicUuid, characteristic.isNotifying, error ? error.localizedDescription.UTF8String : "");
}

#pragma mark - Descriptors

- (BOOL)discoverDescriptors:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid {
    IF(CBPeripheral *, peripheral, [self.peripherals objectForKey:uuid]) {
        IF(CBCharacteristic*, characteristic, [self getCharacteristic:peripheral service:serviceUuid characteristic:characteristicUuid]) {
            [peripheral discoverDescriptorsForCharacteristic:characteristic];
            return YES;
        }
    }
    return NO;
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverDescriptorsForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    std::string uuid = getUuid(peripheral);
    std::string serviceUuid = [characteristic.service.UUID.UUIDString UTF8String];
    std::string characteristicUuid = [characteristic.UUID.UUIDString UTF8String];
    std::vector<std::string> descriptors = getDescriptors(characteristic.descriptors);
    emit.DescriptorsDiscovered(uuid, serviceUuid, characteristicUuid, descriptors, error ? error.localizedDescription.UTF8String : "");
}

- (BOOL)readValue:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid descriptor:(NSString*) descriptorUuid {
    IF(CBPeripheral *, peripheral, [self.peripherals objectForKey:uuid]) {
        IF(CBDescriptor*, descriptor, [self getDescriptor:peripheral service:serviceUuid characteristic:characteristicUuid descriptor:descriptorUuid]) {
            [peripheral readValueForDescriptor:descriptor];
            return YES;
        }
    }
    return NO;
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateValueForDescriptor:(CBDescriptor *)descriptor error:(NSError *)error {
    std::string uuid = getUuid(peripheral);
    std::string serviceUuid = [descriptor.characteristic.service.UUID.UUIDString UTF8String];
    std::string characteristicUuid = [descriptor.characteristic.UUID.UUIDString UTF8String];
    std::string descriptorUuid = [descriptor.UUID.UUIDString UTF8String];
    
    Data data;
    
    if (descriptor.value != nil) {
        if ([descriptor.value isKindOfClass:[NSData class]]) {
            // Handle NSData directly
            NSData *valueData = (NSData *)descriptor.value;
            const UInt8* bytes = (UInt8 *)[valueData bytes];
            data.assign(bytes, bytes + [valueData length]);
        } 
        else if ([descriptor.value isKindOfClass:[NSString class]]) {
            // Convert NSString to bytes
            NSString *valueString = (NSString *)descriptor.value;
            NSData *valueData = [valueString dataUsingEncoding:NSUTF8StringEncoding];
            const UInt8* bytes = (UInt8 *)[valueData bytes];
            data.assign(bytes, bytes + [valueData length]);
        }
        else if ([descriptor.value isKindOfClass:[NSNumber class]]) {
            // Convert NSNumber to bytes
            NSNumber *valueNumber = (NSNumber *)descriptor.value;
            NSData *valueData = [NSData dataWithBytes:valueNumber.stringValue.UTF8String 
                                             length:strlen(valueNumber.stringValue.UTF8String)];
            const UInt8* bytes = (UInt8 *)[valueData bytes];
            data.assign(bytes, bytes + [valueData length]);
        }
    }
    
    IF(NSNumber*, handle, [self getDescriptorHandle:descriptor]) {
        emit.ReadHandle(uuid, [handle intValue], data);
    }
    emit.ReadValue(uuid, serviceUuid, characteristicUuid, descriptorUuid, data, error ? error.localizedDescription.UTF8String : "");
}

- (BOOL)writeValue:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid descriptor:(NSString*) descriptorUuid data:(NSData*) data {
    IF(CBPeripheral *, peripheral, [self.peripherals objectForKey:uuid]) {
        IF(CBDescriptor*, descriptor, [self getDescriptor:peripheral service:serviceUuid characteristic:characteristicUuid descriptor:descriptorUuid]) {
            [peripheral writeValue:data forDescriptor:descriptor];
            return YES;
        }
    }
    return NO;
}

- (void)peripheral:(CBPeripheral *)peripheral didWriteValueForDescriptor:(CBDescriptor *)descriptor error:(NSError *)error {
    std::string uuid = getUuid(peripheral);
    std::string serviceUuid = [descriptor.characteristic.service.UUID.UUIDString UTF8String];
    std::string characteristicUuid = [descriptor.characteristic.UUID.UUIDString UTF8String];
    std::string descriptorUuid = [descriptor.UUID.UUIDString UTF8String];
    IF(NSNumber*, handle, [self getDescriptorHandle:descriptor]) {
        emit.WriteHandle(uuid, [handle intValue]);
    }
    emit.WriteValue(uuid, serviceUuid, characteristicUuid, descriptorUuid, error ? error.localizedDescription.UTF8String : "");
}

- (BOOL)readHandle:(NSString*) uuid handle:(NSNumber*) handle {
    IF(CBPeripheral *, peripheral, [self.peripherals objectForKey:uuid]) {
        IF(CBDescriptor*, descriptor, [self getDescriptor:peripheral ByHandle:handle]) {
            [peripheral readValueForDescriptor:descriptor];
            return YES;
        }
    }
    return NO;
}

- (BOOL)writeHandle:(NSString*) uuid handle:(NSNumber*) handle data:(NSData*) data  {
    IF(CBPeripheral *, peripheral, [self.peripherals objectForKey:uuid]) {
        IF(CBDescriptor*, descriptor, [self getDescriptor:peripheral ByHandle:handle]) {
            [peripheral writeValue:data forDescriptor:descriptor];
            return YES;
        }
    }
    return NO;
}

#pragma mark - Accessor

-(CBService*)getService:(CBPeripheral*) peripheral service:(NSString*) serviceUuid {
    if(peripheral && peripheral.services) {
        for(CBService* service in peripheral.services) {
            if([service.UUID isEqualTo:[CBUUID UUIDWithString:serviceUuid]]) {
                return service;
            }
        }
    }
    return nil;
}

-(CBCharacteristic*)getCharacteristic:(CBPeripheral*) peripheral service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid {
    CBService* service = [self getService:peripheral service:serviceUuid];
    if(service && service.characteristics) {
        for(CBCharacteristic* characteristic in service.characteristics) {
            if([characteristic.UUID isEqualTo:[CBUUID UUIDWithString:characteristicUuid]]) {
                return characteristic;
            }
        }
    }
    return nil;
}

-(CBDescriptor*)getDescriptor:(CBPeripheral*) peripheral service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid descriptor:(NSString*) descriptorUuid {
    CBCharacteristic* characteristic = [self getCharacteristic:peripheral service:serviceUuid characteristic:characteristicUuid];
    if(characteristic && characteristic.descriptors) {
        for(CBDescriptor* descriptor in characteristic.descriptors) {
            if([descriptor.UUID isEqualTo:[CBUUID UUIDWithString:descriptorUuid]]) {
                return descriptor;
            }
        }
    }
    return nil;
}

-(NSNumber*)getDescriptorHandle:(CBDescriptor*) descriptor {
    // use KVC to get the private handle property
    id handle = [descriptor valueForKey:@"handle"];
    if([handle isKindOfClass:[NSNumber class]]) {
        return handle;
    }
    return nil;
}

-(CBDescriptor*)getDescriptor:(CBPeripheral*) peripheral ByHandle:(NSNumber*) handle {
    if(peripheral && peripheral.services) {
        for(CBService* service in peripheral.services) {
            if(service.characteristics) {
                for(CBCharacteristic* characteristic in service.characteristics) {
                    if(characteristic.descriptors) {
                        for(CBDescriptor* descriptor in characteristic.descriptors) {
                            if([handle isEqualTo:[self getDescriptorHandle:descriptor]]) {
                                return descriptor;
                            }
                        }
                    }
                }
            }
        }
    }
    return nil;
}

- (void)dealloc {
    // Clean up GCD timer
    if (self.stateCheckTimer) {
        dispatch_source_cancel(self.stateCheckTimer);
        self.stateCheckTimer = nil;
    }
}

@end
