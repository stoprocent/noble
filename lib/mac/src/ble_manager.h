#pragma once

#import <Foundation/Foundation.h>
#import <CoreBluetooth/CoreBluetooth.h>
#include <dispatch/dispatch.h>

#include "Emit.h"

@interface BLEManager : NSObject <CBCentralManagerDelegate, CBPeripheralDelegate> {
    Emit emit;
    bool pendingRead;
}
@property (strong) CBCentralManager *centralManager;
@property (assign) CBManagerState lastState;
@property dispatch_queue_t dispatchQueue;
@property NSMutableDictionary *peripherals;
@property NSMutableDictionary *mtus;
@property NSMutableSet *discovered;
@property (strong) dispatch_source_t stateCheckTimer;


- (instancetype)init: (const Napi::Value&) receiver with: (const Napi::Function&) callback;
- (void)scan: (NSArray<NSString*> *)serviceUUIDs allowDuplicates: (BOOL)allowDuplicates;
- (void)stopScan;
- (BOOL)connect:(NSString*) uuid;
- (BOOL)disconnect:(NSString*) uuid;
- (BOOL)updateRSSI:(NSString*) uuid;
- (BOOL)discoverServices:(NSString*) uuid serviceUuids:(NSArray<NSString*>*) services;
- (BOOL)discoverIncludedServices:(NSString*) uuid forService:(NSString*) serviceUuid services:(NSArray<NSString*>*) serviceUuids;
- (BOOL)discoverCharacteristics:(NSString*) nsAddress forService:(NSString*) service characteristics:(NSArray<NSString*>*) characteristics;
- (BOOL)read:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid;
- (BOOL)write:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid data:(NSData*) data withoutResponse:(BOOL)withoutResponse;
- (BOOL)notify:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid on:(BOOL)on;
- (BOOL)discoverDescriptors:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid;
- (BOOL)readValue:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid descriptor:(NSString*) descriptorUuid;
- (BOOL)writeValue:(NSString*) uuid service:(NSString*) serviceUuid characteristic:(NSString*) characteristicUuid descriptor:(NSString*) descriptorUuid data:(NSData*) data;
- (BOOL)readHandle:(NSString*) uuid handle:(NSNumber*) handle;
- (BOOL)writeHandle:(NSString*) uuid handle:(NSNumber*) handle data:(NSData*) data;
@end
