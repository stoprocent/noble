#include "peripheral_winrt.h"
#include "winrt_cpp.h"

#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Foundation.Collections.h>
using namespace winrt::Windows::Storage::Streams;

using winrt::Windows::Devices::Bluetooth::BluetoothCacheMode;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattCharacteristicsResult;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattDescriptorsResult;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattDeviceServicesResult;    
using winrt::Windows::Foundation::AsyncStatus;
using winrt::Windows::Foundation::IAsyncOperation;

PeripheralWinrt::PeripheralWinrt(uint64_t bluetoothAddress,
                                 BluetoothLEAdvertisementType advertismentType, const int rssiValue,
                                 const BluetoothLEAdvertisement& advertisment)
{
    this->bluetoothAddress = bluetoothAddress;
    address = formatBluetoothAddress(bluetoothAddress);
    // Random addresses have the two most-significant bits set of the 48-bit address.
    addressType = (bluetoothAddress >= 211106232532992) ? RANDOM : PUBLIC;
    Update(rssiValue, advertisment, advertismentType);
}

PeripheralWinrt::~PeripheralWinrt()
{
    if (device.has_value() && connectionToken)
    {
        device->ConnectionStatusChanged(connectionToken);
    }
}

void PeripheralWinrt::ProcessServiceData(const BluetoothLEAdvertisementDataSection& ds, size_t uuidSize) 
{
    auto d = ds.Data();
    auto dr = DataReader::FromBuffer(d);
    dr.ByteOrder(ByteOrder::LittleEndian);
    
    std::vector<uint8_t> data;
    std::string uuidStr;

    if (uuidSize == 16) { // 128-bit UUID
        uint64_t low = dr.ReadUInt64();
        uint64_t high = dr.ReadUInt64();
        
        char uuid[37];
        snprintf(uuid, sizeof(uuid), 
                "%08x-%04x-%04x-%04x-%012llx",
                (uint32_t)((high >> 32) & 0xFFFFFFFF),
                (uint16_t)((high >> 16) & 0xFFFF),
                (uint16_t)(high & 0xFFFF),
                (uint16_t)((low >> 48) & 0xFFFF),
                (unsigned long long)(low & 0xFFFFFFFFFFFF));
        uuidStr = uuid;
    } 
    else { // 16-bit or 32-bit UUID
        char uuid[9];  // Max 8 chars for 32-bit UUID + null terminator
        if (uuidSize == 2) {
            uint16_t serviceUuid = dr.ReadUInt16();
            snprintf(uuid, sizeof(uuid), "%04x", serviceUuid);
        } else { // 4 bytes
            uint32_t serviceUuid = dr.ReadUInt32();
            snprintf(uuid, sizeof(uuid), "%08x", serviceUuid);
        }
        uuidStr = uuid;
    }
    
    // Read remaining data
    data.resize(d.Length() - uuidSize);
    dr.ReadBytes(data);
    
    // Initialize serviceData if it doesn't exist
    if (!serviceData.has_value()) {
        serviceData = std::vector<std::pair<std::string, Data>>();
    }
    
    // Find and update existing entry or add new one
    bool found = false;
    for (auto& pair : serviceData.value()) {
        if (pair.first == uuidStr) {
            pair.second = data;
            found = true;
            break;
        }
    }
    
    if (!found) {
        serviceData.value().push_back(std::make_pair(uuidStr, data));
    }
    
    dr.Close();
}

void PeripheralWinrt::Update(const int rssiValue, const BluetoothLEAdvertisement& advertisment,
                             const BluetoothLEAdvertisementType& advertismentType)
{
    // Handle name
    std::string localName = ws2s(advertisment.LocalName().c_str());
    if (!localName.empty())
    {
        name = std::optional<std::string>(localName);
    }

    connectable = advertismentType == BluetoothLEAdvertisementType::ConnectableUndirected ||
        advertismentType == BluetoothLEAdvertisementType::ConnectableDirected;

    // Reset optional values
    manufacturerData = std::nullopt;
    serviceData = std::nullopt;
    serviceUuids = std::nullopt;

    for (auto ds : advertisment.DataSections())
    {
        if (ds.DataType() == BluetoothLEAdvertisementDataTypes::TxPowerLevel())
        {
            auto d = ds.Data();
            auto dr = DataReader::FromBuffer(d);
            int power = dr.ReadByte();
            if (power >= 128)
                power -= 256;
            txPowerLevel = std::optional<int>(power);
            dr.Close();
        }
        else if (ds.DataType() == BluetoothLEAdvertisementDataTypes::ManufacturerSpecificData())
        {
            auto d = ds.Data();
            auto dr = DataReader::FromBuffer(d);
            Data mData;
            mData.resize(d.Length());
            dr.ReadBytes(mData);
            manufacturerData = std::optional<Data>(mData);
            dr.Close();
        }
        else if (ds.DataType() == BluetoothLEAdvertisementDataTypes::ServiceData16BitUuids())
        {
            ProcessServiceData(ds, 2);  // 2 bytes for 16-bit UUID
        }
        else if (ds.DataType() == BluetoothLEAdvertisementDataTypes::ServiceData32BitUuids())
        {
            ProcessServiceData(ds, 4);  // 4 bytes for 32-bit UUID
        }
        else if (ds.DataType() == BluetoothLEAdvertisementDataTypes::ServiceData128BitUuids())
        {
            ProcessServiceData(ds, 16);  // 16 bytes for 128-bit UUID
        }
    }

    // Handle service UUIDs
    std::vector<std::string> uuids;
    for (auto uuid : advertisment.ServiceUuids())
    {
        uuids.push_back(toStr(uuid));
    }
    if (!uuids.empty())
    {
        serviceUuids = std::optional<std::vector<std::string>>(uuids);
    }

    rssi = rssiValue;
}

void PeripheralWinrt::Disconnect()
{
    //clean up to ensure disconnect from Windows
    for(auto const& cachedService : cachedServices)
    {
        cachedService.second.service.Close();
    }
    cachedServices.clear();
    if (gattSession.has_value())
    {
        if(maxPduSizeChangedToken)
        {
            gattSession->MaxPduSizeChanged(maxPduSizeChangedToken);
        }
        gattSession->Close();
    }
    if (device.has_value())
    {
        if(connectionToken)
        {
            device->ConnectionStatusChanged(connectionToken);
        }
        device->Close();
    }
    device = std::nullopt;
}

void PeripheralWinrt::GetServiceFromDevice(
    winrt::guid serviceUuid, std::function<void(std::optional<GattDeviceService>)> callback)
{
    if (device.has_value())
    {
        device->GetGattServicesForUuidAsync(serviceUuid, BluetoothCacheMode::Cached)
            .Completed([=](IAsyncOperation<GattDeviceServicesResult> result, auto& status) {
                if (status == AsyncStatus::Completed)
                {
                    auto services = result.GetResults();
                    auto service = services.Services().First();
                    if (service.HasCurrent())
                    {
                        GattDeviceService s = service.Current();
                        cachedServices.insert(std::make_pair(serviceUuid, CachedService(s)));
                        callback(s);
                    }
                    else
                    {
                        printf("GetGattServicesForUuidAsync: no service with given id\n");
                        callback(std::nullopt);
                    }
                }
                else
                {
                    printf("GetGattServicesForUuidAsync: failed with status: %d\n", status);
                    callback(std::nullopt);
                }
            });
    }
    else
    {
        printf("GetGattServicesForUuidAsync: no device currently connected\n");
        callback(std::nullopt);
    }
}

void PeripheralWinrt::GetService(winrt::guid serviceUuid,
                                 std::function<void(std::optional<GattDeviceService>)> callback)
{
    auto it = cachedServices.find(serviceUuid);
    if (it != cachedServices.end())
    {
        callback(it->second.service);
    }
    else
    {
        GetServiceFromDevice(serviceUuid, callback);
    }
}

void PeripheralWinrt::GetCharacteristicFromService(
    GattDeviceService service, winrt::guid characteristicUuid,
    std::function<void(std::optional<GattCharacteristic>)> callback)
{
    service.GetCharacteristicsForUuidAsync(characteristicUuid, BluetoothCacheMode::Cached)
        .Completed([=](IAsyncOperation<GattCharacteristicsResult> result, auto& status) {
            if (status == AsyncStatus::Completed)
            {
                auto characteristics = result.GetResults();
                auto characteristic = characteristics.Characteristics().First();
                if (characteristic.HasCurrent())
                {
                    winrt::guid serviceUuid = service.Uuid();
                    CachedService& cachedService = cachedServices[serviceUuid];
                    GattCharacteristic c = characteristic.Current();
                    cachedService.characterisitics.insert(
                        std::make_pair(c.Uuid(), CachedCharacteristic(c)));
                    callback(c);
                }
                else
                {
                    printf("GetCharacteristicsForUuidAsync: no characteristic with given id\n");
                    callback(std::nullopt);
                }
            }
            else
            {
                printf("GetCharacteristicsForUuidAsync: failed with status: %d\n", status);
                callback(std::nullopt);
            }
        });
}

void PeripheralWinrt::GetCharacteristic(
    winrt::guid serviceUuid, winrt::guid characteristicUuid,
    std::function<void(std::optional<GattCharacteristic>)> callback)
{
    auto it = cachedServices.find(serviceUuid);
    if (it != cachedServices.end())
    {
        auto& cachedService = it->second;
        auto cit = cachedService.characterisitics.find(characteristicUuid);
        if (cit != cachedService.characterisitics.end())
        {
            callback(cit->second.characteristic);
        }
        else
        {
            GetCharacteristicFromService(cachedService.service, characteristicUuid, callback);
        }
    }
    else
    {
        GetServiceFromDevice(serviceUuid, [=](std::optional<GattDeviceService> service) {
            if (service)
            {
                GetCharacteristicFromService(*service, characteristicUuid, callback);
            }
            else
            {
                printf("GetCharacteristic: get service failed\n");
                callback(nullptr);
            }
        });
    }
}

void PeripheralWinrt::GetDescriptorFromCharacteristic(
    GattCharacteristic characteristic, winrt::guid descriptorUuid,
    std::function<void(std::optional<GattDescriptor>)> callback)
{
    characteristic.GetDescriptorsForUuidAsync(descriptorUuid, BluetoothCacheMode::Cached)
        .Completed([=](IAsyncOperation<GattDescriptorsResult> result, auto& status) {
            if (status == AsyncStatus::Completed)
            {
                auto descriptors = result.GetResults();
                auto descriptor = descriptors.Descriptors().First();
                if (descriptor.HasCurrent())
                {
                    GattDescriptor d = descriptor.Current();
                    winrt::guid characteristicUuid = characteristic.Uuid();
                    winrt::guid descriptorUuid = d.Uuid();
                    winrt::guid serviceUuid = characteristic.Service().Uuid();
                    CachedService& cachedService = cachedServices[serviceUuid];
                    CachedCharacteristic& c = cachedService.characterisitics[characteristicUuid];
                    c.descriptors.insert(std::make_pair(descriptorUuid, d));
                    callback(d);
                }
                else
                {
                    printf("GetDescriptorsForUuidAsync: no characteristic with given id\n");
                    callback(std::nullopt);
                }
            }
            else
            {
                printf("GetDescriptorsForUuidAsync: failed with status: %d\n", status);
                callback(std::nullopt);
            }
        });
}

void PeripheralWinrt::GetDescriptor(winrt::guid serviceUuid, winrt::guid characteristicUuid,
                                    winrt::guid descriptorUuid,
                                    std::function<void(std::optional<GattDescriptor>)> callback)
{
    auto it = cachedServices.find(serviceUuid);
    if (it != cachedServices.end())
    {
        auto& cachedService = it->second;
        auto cit = cachedService.characterisitics.find(characteristicUuid);
        if (cit != cachedService.characterisitics.end())
        {
            GetDescriptorFromCharacteristic(cit->second.characteristic, descriptorUuid, callback);
        }
        else
        {
            GetCharacteristicFromService(
                cachedService.service, characteristicUuid,
                [=](std::optional<GattCharacteristic> characteristic) {
                    if (characteristic)
                    {
                        GetDescriptorFromCharacteristic(*characteristic, descriptorUuid,
                                                            callback);
                    }
                    else
                    {
                        printf("GetDescriptor: get characteristic failed 1\n");
                        callback(nullptr);
                    }
                });
        }
    }
    else
    {
        GetServiceFromDevice(serviceUuid, [=](std::optional<GattDeviceService> service) {
            if (service)
            {
                GetCharacteristicFromService(
                    *service, characteristicUuid,
                    [=](std::optional<GattCharacteristic> characteristic) {
                        if (characteristic)
                        {
                            GetDescriptorFromCharacteristic(*characteristic, descriptorUuid,
                                                            callback);
                        }
                        else
                        {
                            printf("GetDescriptor: get characteristic failed 2\n");
                            callback(nullptr);
                        }
                    });
            }
            else
            {
                printf("GetDescriptor: get service failed\n");
                callback(nullptr);
            }
        });
    }
}
