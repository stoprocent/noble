#include "ble_manager.h"
#include "winrt_cpp.h"

#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Devices.Bluetooth.h>
#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>


using winrt::Windows::Devices::Bluetooth::BluetoothCacheMode;
using winrt::Windows::Devices::Bluetooth::BluetoothConnectionStatus;
using winrt::Windows::Devices::Bluetooth::BluetoothLEDevice;
using winrt::Windows::Devices::Bluetooth::BluetoothUuidHelper;
using winrt::Windows::Storage::Streams::DataReader;
using winrt::Windows::Storage::Streams::DataWriter;
using winrt::Windows::Storage::Streams::IBuffer;
using winrt::Windows::Storage::Streams::ByteOrder;
using winrt::Windows::Security::Cryptography::CryptographicBuffer;
using winrt::Windows::Devices::Bluetooth::Advertisement::BluetoothLEAdvertisementBytePattern;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattSession;

template <typename T> auto inFilter(std::vector<T> filter, T object)
{
    return filter.empty() || std::find(filter.begin(), filter.end(), object) != filter.end();
}

template <typename O, typename M, class... Types> auto bind2(O* object, M method, Types&... args)
{
    return std::bind(method, object, std::placeholders::_1, std::placeholders::_2, args...);
}

#define LOGE(message, ...) printf(__FUNCTION__ ": " message "\n", __VA_ARGS__)

#define CHECK_DEVICE()                                     \
    if (mDeviceMap.find(uuid) == mDeviceMap.end())         \
    {                                                      \
        LOGE("device with id %s not found", uuid.c_str()); \
        return false;                                      \
    }

#define IFDEVICE(_device, _uuid)                     \
    PeripheralWinrt& peripheral = mDeviceMap[_uuid]; \
    if (!peripheral.device.has_value())              \
    {                                                \
        LOGE("device not connected");                \
        return false;                                \
    }                                                \
    BluetoothLEDevice& _device = *peripheral.device;

std::string gattStatusToString(GattCommunicationStatus status) {
    switch (status) {
        case GattCommunicationStatus::Success:
            return "Success";
        case GattCommunicationStatus::Unreachable:
            return "Device is unreachable";
        case GattCommunicationStatus::ProtocolError:
            return "Protocol error";
        case GattCommunicationStatus::AccessDenied:
            return "Access denied";
        default:
            return "Unknown error (" + std::to_string(static_cast<int>(status)) + ")";
    }
}

std::string asyncStatusToString(AsyncStatus status) {
    switch (status) {
        case AsyncStatus::Completed:
            return "Completed";
        case AsyncStatus::Started:
            return "Operation still in progress";
        case AsyncStatus::Canceled:
            return "Operation was canceled";
        case AsyncStatus::Error:
            return "Operation failed with error";
        default:
            return "Unknown status (" + std::to_string(static_cast<int>(status)) + ")";
    }
}

#define CHECK_STATUS_AND_RESULT(_status, _result, _error_emit_func)              \
    do                                                                           \
    {                                                                            \
        if ((_status) != AsyncStatus::Completed)                                 \
        {                                                                        \
            _error_emit_func(asyncStatusToString(_status));                      \
            return;                                                              \
        }                                                                        \
        if (!(_result))                                                          \
        {                                                                        \
            _error_emit_func("Operation result is null");                        \
            return;                                                              \
        }                                                                        \
        auto _commStatus = (_result).Status();                                   \
        if ((_commStatus) != GattCommunicationStatus::Success)                   \
        {                                                                        \
            _error_emit_func(gattStatusToString(_commStatus));                   \
            return;                                                              \
        }                                                                        \
    } while (0)


#define FOR(object, vector)       \
    auto _vector = vector;       \
    if (!_vector)                 \
    {                             \
        LOGE(#vector " is null"); \
        return;                   \
    }                             \
    else                          \
        for (auto&& object : _vector)

struct ServiceDataTypeInfo {
    uint8_t dataType;
    std::function<winrt::guid(DataReader&)> uuidConverter;
};

const std::vector<ServiceDataTypeInfo> serviceDataTypes = {
    {
        BluetoothLEAdvertisementDataTypes::ServiceData16BitUuids(),
        [](DataReader& reader) { return BluetoothUuidHelper::FromShortId(reader.ReadUInt16()); }
    },
    {
        BluetoothLEAdvertisementDataTypes::ServiceData32BitUuids(),
        [](DataReader& reader) { return BluetoothUuidHelper::FromShortId(reader.ReadUInt32()); }
    },
    {
        BluetoothLEAdvertisementDataTypes::ServiceData128BitUuids(),
        [](DataReader& reader) { return reader.ReadGuid(); }
    }
};

BLEManager::BLEManager(const Napi::Value& receiver, const Napi::Function& callback)
{
    mRadioState = AdapterState::Initial;
    mEmit.Wrap(receiver, callback);
    auto onRadio = std::bind(&BLEManager::OnRadio, this, std::placeholders::_1, std::placeholders::_2);
    mWatcher.Start(onRadio);
    mAdvertismentWatcher.ScanningMode(BluetoothLEScanningMode::Active);
    auto onReceived = bind2(this, &BLEManager::OnScanResult);
    mReceivedRevoker = mAdvertismentWatcher.Received(winrt::auto_revoke, onReceived);
    auto onStopped = bind2(this, &BLEManager::OnScanStopped);
    mStoppedRevoker = mAdvertismentWatcher.Stopped(winrt::auto_revoke, onStopped);
}

void BLEManager::OnRadio(Radio& radio, const AdapterCapabilities& capabilities)
{
    auto state = AdapterState::Unsupported;
    if (radio)
    {
        state = (AdapterState)radio.State();
    }
    if (state != mRadioState)
    {
        mRadioState = state;
        mEmit.RadioState(adapterStateToString(state));
    }
    if (capabilities.bluetoothAddress > 0)
    {
        mEmit.Address(formatBluetoothAddress(capabilities.bluetoothAddress));
    }
}

void BLEManager::Scan(const std::vector<winrt::guid>& serviceUUIDs, bool allowDuplicates)
{
    mAdvertismentMap.clear();
    mAllowDuplicates = allowDuplicates;
    mScanServiceUUIDs = serviceUUIDs;

    BluetoothLEAdvertisementFilter filter = BluetoothLEAdvertisementFilter();
    BluetoothLEAdvertisement advertisment = BluetoothLEAdvertisement();
    auto services = advertisment.ServiceUuids();
    // This was replaced by the filtering after the scan result
    // for (auto uuid : serviceUUIDs)
    // {
    //     services.Append(uuid);
    // }
    // filter.Advertisement(advertisment);
    mAdvertismentWatcher.AdvertisementFilter(filter);

    mAdvertismentWatcher.Start();
    mEmit.ScanState(true);
}

void BLEManager::OnScanResult(BluetoothLEAdvertisementWatcher watcher,
                              const BluetoothLEAdvertisementReceivedEventArgs& args)
{
    uint64_t bluetoothAddress = args.BluetoothAddress();
    std::string uuid = formatBluetoothUuid(bluetoothAddress);
    int16_t rssi = args.RawSignalStrengthInDBm();
    auto advertismentType = args.AdvertisementType();
    auto advertisment = args.Advertisement();

    if (!mScanServiceUUIDs.empty()) {
        auto found = false;
        std::vector<winrt::guid> serviceUUIDs;

        for (const auto& typeInfo : serviceDataTypes) {
            auto sections = advertisment.GetSectionsByType(typeInfo.dataType);
            for (auto section : sections) {
                auto reader = DataReader::FromBuffer(section.Data());
                reader.ByteOrder(ByteOrder::LittleEndian);
                auto uuid = typeInfo.uuidConverter(reader);
                if (inFilter(mScanServiceUUIDs, uuid)) {
                    found = true;
                    break;
                }
            }
            if (found) break;
        }

        auto serviceUuids = advertisment.ServiceUuids();
        for (auto uuid : serviceUuids) {
            if (inFilter(mScanServiceUUIDs, uuid)) {
                found = true;
                break;
            }
        }

        if (!found) {
            return;
        }
    }

    
    if (mDeviceMap.find(uuid) == mDeviceMap.end())
    {
        mAdvertismentMap.insert(uuid);
        auto peripheral =
            PeripheralWinrt(bluetoothAddress, advertismentType, rssi, args.Advertisement());
        mEmit.Scan(uuid, rssi, peripheral);
        mDeviceMap.emplace(std::make_pair(uuid, std::move(peripheral)));
    }
    else
    {
        PeripheralWinrt& peripheral = mDeviceMap[uuid];
        peripheral.Update(rssi, args.Advertisement(), advertismentType);
        if (mAllowDuplicates || mAdvertismentMap.find(uuid) == mAdvertismentMap.end())
        {
            mAdvertismentMap.insert(uuid);
            mEmit.Scan(uuid, rssi, peripheral);
        }
    }
}

void BLEManager::StopScan()
{
    mAdvertismentWatcher.Stop();
    
    auto status = mAdvertismentWatcher.Status();
    if (status == BluetoothLEAdvertisementWatcherStatus::Stopped ||
        status == BluetoothLEAdvertisementWatcherStatus::Aborted) {
        mEmit.ScanState(false);
    }
}

void BLEManager::OnScanStopped(BluetoothLEAdvertisementWatcher watcher,
                               const BluetoothLEAdvertisementWatcherStoppedEventArgs& args)
{
    mEmit.ScanState(false);
}

bool BLEManager::Connect(const std::string& uuid)
{
    if (mDeviceMap.find(uuid) == mDeviceMap.end())
    {
        // Convert UUID string to MAC address format
        // Remove any colons if present and convert to uppercase
        std::string cleanUuid = uuid;
        cleanUuid.erase(std::remove(cleanUuid.begin(), cleanUuid.end(), ':'), cleanUuid.end());
        
        // Basic validation
        if (cleanUuid.length() != 12) {
            mEmit.Connected(uuid, "invalid device address format");
            return false;
        }

        try {
            // Convert string to uint64_t bluetooth address
            uint64_t bluetoothAddress = std::stoull(cleanUuid, nullptr, 16);
            
            // Create a new peripheral entry as if it was scanned
            auto peripheral = PeripheralWinrt(bluetoothAddress, 
                                            BluetoothLEAdvertisementType::ConnectableUndirected, 
                                            127,  // default RSSI for direct connect
                                            BluetoothLEAdvertisement()); // empty advertisement
            
            // Emit scan event just like during normal scanning
            mEmit.Scan(uuid, 127, peripheral);
            
            // Add to device map
            mDeviceMap.emplace(std::make_pair(uuid, std::move(peripheral)));
        } catch (const std::exception& e) {
            mEmit.Connected(uuid, "invalid device address format");
            return false;
        }
    }

    PeripheralWinrt& peripheral = mDeviceMap[uuid];
    if (!peripheral.device.has_value())
    {
        auto completed = bind2(this, &BLEManager::OnConnected, uuid);
        BluetoothLEDevice::FromBluetoothAddressAsync(peripheral.bluetoothAddress)
            .Completed(completed);
    }
    else
    {
        mEmit.Connected(uuid);
    }
    return true;
}

void BLEManager::OnConnected(IAsyncOperation<BluetoothLEDevice> asyncOp, AsyncStatus status,
                             const std::string uuid)
{
    if (status == AsyncStatus::Completed)
    {
        BluetoothLEDevice device = asyncOp.GetResults();
        // device can be null if the connection failed
        if (device)
        {
            auto onChanged = bind2(this, &BLEManager::OnConnectionStatusChanged);
            auto token = device.ConnectionStatusChanged(onChanged);
            auto uuid = formatBluetoothUuid(device.BluetoothAddress());
            PeripheralWinrt& peripheral = mDeviceMap[uuid];
            peripheral.device = device;
            peripheral.connectionToken = token;
            mEmit.Connected(uuid);
            
            // Get GATT session to access the MTU
            auto completed = bind2(this, &BLEManager::OnGattSessionCreated, uuid);
            GattSession::FromDeviceIdAsync(device.BluetoothDeviceId()).Completed(completed);
        }
        else
        {
            mEmit.Connected(uuid, "could not connect to device: result is null");
        }
    }
    else
    {
        mEmit.Connected(uuid, "could not connect to device");
    }
}

void BLEManager::OnGattSessionCreated(IAsyncOperation<GattSession> asyncOp, AsyncStatus status, const std::string uuid)
{
    if (status == AsyncStatus::Completed)
    {
        auto session = asyncOp.GetResults();
        if (session)
        {
            // MaxPduSize is equivalent to the MTU-3 (MTU minus ATT header)
            // MTU = MaxPduSize + 3
            int mtu = session.MaxPduSize();
            mEmit.MTU(uuid, mtu);
            
            // Subscribe to MTU changes
            auto onPduSizeChanged = bind2(this, &BLEManager::OnMaxPduSizeChanged, uuid);
            
            // Store both the session and the event token in the peripheral
            PeripheralWinrt& peripheral = mDeviceMap[uuid];
            peripheral.gattSession = session;
            auto token = session.MaxPduSizeChanged(onPduSizeChanged);
            peripheral.maxPduSizeChangedToken = token;
        }
        else
        {
            LOGE("Failed to get GattSession for device %s", uuid.c_str());
        }
    }
    else
    {
        LOGE("Failed to create GattSession: %s", asyncStatusToString(status).c_str());
    }
}

// Add this new method to handle the MaxPduSizeChanged event
void BLEManager::OnMaxPduSizeChanged(GattSession session, winrt::Windows::Foundation::IInspectable object, const std::string uuid)
{
    // Update MTU value when it changes
    int mtu = session.MaxPduSize();
    mEmit.MTU(uuid, mtu);
}

bool BLEManager::Disconnect(const std::string& uuid)
{
    CHECK_DEVICE();
    PeripheralWinrt& peripheral = mDeviceMap[uuid];
    peripheral.Disconnect();
    mNotifyMap.Remove(uuid);
    mEmit.Disconnected(uuid);
    return true;
}

bool BLEManager::CancelConnect(const std::string& uuid)
{
    CHECK_DEVICE();
    PeripheralWinrt& peripheral = mDeviceMap[uuid];
    peripheral.Disconnect();
    mNotifyMap.Remove(uuid);
    return true;
}

void BLEManager::OnConnectionStatusChanged(BluetoothLEDevice device,
                                           winrt::Windows::Foundation::IInspectable inspectable)
{
    if (device.ConnectionStatus() == BluetoothConnectionStatus::Disconnected)
    {
        auto uuid = formatBluetoothUuid(device.BluetoothAddress());
        if (mDeviceMap.find(uuid) == mDeviceMap.end())
        {
            LOGE("device with id %s not found", uuid.c_str());
            return;
        }
        PeripheralWinrt& peripheral = mDeviceMap[uuid];
        if(peripheral.device.has_value() && &(peripheral.device.value()) == &device )
        {
            peripheral.Disconnect();
            mNotifyMap.Remove(uuid);
            mEmit.Disconnected(uuid);
        }
    }
}

bool BLEManager::UpdateRSSI(const std::string& uuid)
{
    CHECK_DEVICE();

    PeripheralWinrt& peripheral = mDeviceMap[uuid];
    // no way to get the rssi while we are connected, return the last value of advertisement
    mEmit.RSSI(uuid, peripheral.rssi);
    return true;
}

bool BLEManager::DiscoverServices(const std::string& uuid,
                                  const std::vector<winrt::guid>& serviceUUIDs)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        auto completed = bind2(this, &BLEManager::OnServicesDiscovered, uuid, serviceUUIDs);
        device.GetGattServicesAsync(BluetoothCacheMode::Uncached).Completed(completed);
        return true;
    }
}

void BLEManager::OnServicesDiscovered(IAsyncOperation<GattDeviceServicesResult> asyncOp,
                                      AsyncStatus status, const std::string uuid,
                                      const std::vector<winrt::guid> serviceUUIDs)
{
    auto result = asyncOp.GetResults();
    std::vector<std::string> serviceUuids;
    
    auto emit = [this, uuid, &serviceUuids](const std::string& err) {
        auto error = err + " while discovering services";
        mEmit.ServicesDiscovered(uuid, serviceUuids, error);
    };

    CHECK_STATUS_AND_RESULT(status, result, emit);
    PeripheralWinrt& peripheral = mDeviceMap[uuid];
    FOR(service, result.Services())
    {
        auto id = service.Uuid();
        if (inFilter(serviceUUIDs, id))
        {
            serviceUuids.push_back(toStr(id));
        }
        //remember for cleanup
        peripheral.cachedServices.insert(std::make_pair(id, CachedService(service)));
    }
    mEmit.ServicesDiscovered(uuid, serviceUuids);
}

bool BLEManager::DiscoverIncludedServices(const std::string& uuid, const winrt::guid& serviceUuid,
                                          const std::vector<winrt::guid>& serviceUUIDs)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        peripheral.GetService(serviceUuid, [=](std::optional<GattDeviceService> service) {
            if (service)
            {
                std::string serviceId = toStr(serviceUuid);
                service->GetIncludedServicesAsync(BluetoothCacheMode::Uncached)
                    .Completed(bind2(this, &BLEManager::OnIncludedServicesDiscovered, uuid,
                                     serviceId, serviceUUIDs));
            }
            else
            {
                LOGE("GetService error");
            }
        });
        return true;
    }
}

void BLEManager::OnIncludedServicesDiscovered(IAsyncOperation<GattDeviceServicesResult> asyncOp,
                                              AsyncStatus status, const std::string uuid,
                                              const std::string serviceId,
                                              const std::vector<winrt::guid> serviceUUIDs)
{
    auto result = asyncOp.GetResults();
    std::vector<std::string> servicesUuids;
    
    auto emit = [this, uuid, serviceId, &servicesUuids](const std::string& err) { 
        auto error = err + " while discovering included services for service " + serviceId;
        mEmit.IncludedServicesDiscovered(uuid, serviceId, servicesUuids, error); 
    };

    CHECK_STATUS_AND_RESULT(status, result, emit);
    PeripheralWinrt& peripheral = mDeviceMap[uuid];
    FOR(service, result.Services())
    {
        auto id = service.Uuid();
        if (inFilter(serviceUUIDs, id))
        {
            servicesUuids.push_back(toStr(id));
        }
        //remember for cleanup
        peripheral.cachedServices.insert(std::make_pair(id, CachedService(service)));
    }
    mEmit.IncludedServicesDiscovered(uuid, serviceId, servicesUuids);
}

bool BLEManager::DiscoverCharacteristics(const std::string& uuid, const winrt::guid& serviceUuid,
                                         const std::vector<winrt::guid>& characteristicUUIDs)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        peripheral.GetService(serviceUuid, [=](std::optional<GattDeviceService> service) {
            if (service)
            {
                std::string serviceId = toStr(serviceUuid);
                service->GetCharacteristicsAsync(BluetoothCacheMode::Uncached)
                    .Completed(bind2(this, &BLEManager::OnCharacteristicsDiscovered, uuid,
                                     serviceId, characteristicUUIDs));
            }
            else
            {
                LOGE("GetService error");
            }
        });
        return true;
    }
}

void BLEManager::OnCharacteristicsDiscovered(IAsyncOperation<GattCharacteristicsResult> asyncOp,
                                             AsyncStatus status, const std::string uuid,
                                             const std::string serviceId,
                                             const std::vector<winrt::guid> characteristicUUIDs)
{
    auto result = asyncOp.GetResults();
    std::vector<std::pair<std::string, std::vector<std::string>>> characteristicsUuids;

    auto emit = [this, uuid, serviceId, &characteristicsUuids](const std::string& err) { 
        auto error = err + " while discovering characteristics for service " + serviceId;
        mEmit.CharacteristicsDiscovered(uuid, serviceId, characteristicsUuids, error); 
    };
    
    CHECK_STATUS_AND_RESULT(status, result, emit);
    FOR(characteristic, result.Characteristics())
    {
        auto id = characteristic.Uuid();
        if (inFilter(characteristicUUIDs, id))
        {
            auto props = characteristic.CharacteristicProperties();
            characteristicsUuids.push_back({ toStr(id), toPropertyArray(props) });
        }
    }
    mEmit.CharacteristicsDiscovered(uuid, serviceId, characteristicsUuids);
}

bool BLEManager::Read(const std::string& uuid, const winrt::guid& serviceUuid,
                      const winrt::guid& characteristicUuid)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        peripheral.GetCharacteristic(
            serviceUuid, characteristicUuid, [=](std::optional<GattCharacteristic> characteristic) {
                if (characteristic)
                {
                    std::string serviceId = toStr(serviceUuid);
                    std::string characteristicId = toStr(characteristicUuid);
                    characteristic->ReadValueAsync(BluetoothCacheMode::Uncached)
                        .Completed(
                            bind2(this, &BLEManager::OnRead, uuid, serviceId, characteristicId));
                }
                else
                {
                    LOGE("GetCharacteristic error");
                }
            });
        return true;
    }
}

void BLEManager::OnRead(IAsyncOperation<GattReadResult> asyncOp, AsyncStatus status,
                        const std::string uuid, const std::string serviceId,
                        const std::string characteristicId)
{
    auto result = asyncOp.GetResults();

    auto emit = [this, uuid, serviceId, characteristicId](const std::string& err) { 
        auto error = err + " while reading characteristic " + characteristicId;
        mEmit.Read(uuid, serviceId, characteristicId, Data(), false, error); 
    };

    CHECK_STATUS_AND_RESULT(status, result, emit);

    auto value = result.Value();
    if (value)
    {
        auto reader = DataReader::FromBuffer(value);
        Data data(reader.UnconsumedBufferLength());
        reader.ReadBytes(data);
        mEmit.Read(uuid, serviceId, characteristicId, data, false);
    }
    else {
        mEmit.Read(uuid, serviceId, characteristicId, Data(), false, "value is null");
    }
}

bool BLEManager::Write(const std::string& uuid, const winrt::guid& serviceUuid,
                       const winrt::guid& characteristicUuid, const Data& data,
                       bool withoutResponse)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        peripheral.GetCharacteristic(
            serviceUuid, characteristicUuid, [=](std::optional<GattCharacteristic> characteristic) {
                if (characteristic)
                {
                    std::string serviceId = toStr(serviceUuid);
                    std::string characteristicId = toStr(characteristicUuid);
                    auto writer = DataWriter();
                    writer.WriteBytes(data);
                    auto value = writer.DetachBuffer();
                    GattWriteOption option = withoutResponse ? GattWriteOption::WriteWithoutResponse
                                                             : GattWriteOption::WriteWithResponse;
                    characteristic->WriteValueWithResultAsync(value, option)
                        .Completed(
                            bind2(this, &BLEManager::OnWrite, uuid, serviceId, characteristicId));
                }
                else
                {
                    LOGE("GetCharacteristic error");
                }
            });
        return true;
    }
}

void BLEManager::OnWrite(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status,
                         const std::string uuid, const std::string serviceId,
                         const std::string characteristicId)
{
    if (status == AsyncStatus::Completed)
    {
        mEmit.Write(uuid, serviceId, characteristicId);
    }
    else
    {
        std::string error = "status: " + std::to_string((int)status);
        mEmit.Write(uuid, serviceId, characteristicId, error);
    }
}

GattClientCharacteristicConfigurationDescriptorValue
GetDescriptorValue(GattCharacteristicProperties properties)
{
    if ((properties & GattCharacteristicProperties::Indicate) ==
        GattCharacteristicProperties::Indicate)
    {
        return GattClientCharacteristicConfigurationDescriptorValue::Indicate;
    }
    else
    {
        return GattClientCharacteristicConfigurationDescriptorValue::Notify;
    }
}

bool BLEManager::Notify(const std::string& uuid, const winrt::guid& serviceUuid,
                        const winrt::guid& characteristicUuid, bool on)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        auto onCharacteristic = [=](std::optional<GattCharacteristic> characteristic) {
            if (characteristic)
            {
                std::string serviceId = toStr(serviceUuid);
                std::string characteristicId = toStr(characteristicUuid);
                bool subscribed = mNotifyMap.IsSubscribed(uuid, *characteristic);

                if (on)
                {
                    if (subscribed)
                    {
                        // already listening
                        mEmit.Notify(uuid, serviceId, characteristicId, true);
                        return;
                    }
                    auto descriptorValue =
                        GetDescriptorValue(characteristic->CharacteristicProperties());

                    auto completed = bind2(this, &BLEManager::OnNotify, *characteristic, uuid,
                                           serviceId, characteristicId, on);
                    characteristic
                        ->WriteClientCharacteristicConfigurationDescriptorWithResultAsync(
                            descriptorValue)
                        .Completed(completed);
                }
                else
                {
                    if (!subscribed)
                    {
                        // already not listening
                        mEmit.Notify(uuid, serviceId, characteristicId, false);
                        return;
                    }

                    mNotifyMap.Unsubscribe(uuid, *characteristic);
                    auto descriptorValue =
                        GattClientCharacteristicConfigurationDescriptorValue::None;
                    auto completed = bind2(this, &BLEManager::OnNotify, *characteristic, uuid,
                                           serviceId, characteristicId, on);
                    characteristic
                        ->WriteClientCharacteristicConfigurationDescriptorWithResultAsync(
                            descriptorValue)
                        .Completed(completed);
                }
            }
            else
            {
                LOGE("GetCharacteristic error");
            }
        };
        peripheral.GetCharacteristic(serviceUuid, characteristicUuid, onCharacteristic);
        return true;
    }
}

void BLEManager::OnNotify(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status,
                          const GattCharacteristic characteristic, const std::string uuid,
                          const std::string serviceId, const std::string characteristicId,
                          const bool state)
{
    if (status == AsyncStatus::Completed)
    {
        if (state == true)
        {
            auto onChanged = bind2(this, &BLEManager::OnValueChanged, uuid);
            auto token = characteristic.ValueChanged(onChanged);
            mNotifyMap.Add(uuid, characteristic, token);
        }
        mEmit.Notify(uuid, serviceId, characteristicId, state);
    }
    else
    {
        std::string error = "status: " + std::to_string((int)status);
        mEmit.Notify(uuid, serviceId, characteristicId, state, error);
    }
}

void BLEManager::OnValueChanged(GattCharacteristic characteristic,
                                const GattValueChangedEventArgs& args, std::string deviceUuid)
{
    auto reader = DataReader::FromBuffer(args.CharacteristicValue());
    Data data(reader.UnconsumedBufferLength());
    reader.ReadBytes(data);
    auto characteristicUuid = toStr(characteristic.Uuid());
    auto serviceUuid = toStr(characteristic.Service().Uuid());
    mEmit.Read(deviceUuid, serviceUuid, characteristicUuid, data, true);
}

bool BLEManager::DiscoverDescriptors(const std::string& uuid, const winrt::guid& serviceUuid,
                                     const winrt::guid& characteristicUuid)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        peripheral.GetCharacteristic(
            serviceUuid, characteristicUuid, [=](std::optional<GattCharacteristic> characteristic) {
                if (characteristic)
                {
                    std::string serviceId = toStr(serviceUuid);
                    std::string characteristicId = toStr(characteristicUuid);
                    auto completed = bind2(this, &BLEManager::OnDescriptorsDiscovered, uuid,
                                           serviceId, characteristicId);
                    characteristic->GetDescriptorsAsync(BluetoothCacheMode::Uncached)
                        .Completed(completed);
                }
                else
                {
                    LOGE("GetCharacteristic error");
                }
            });
        return true;
    }
}

void BLEManager::OnDescriptorsDiscovered(IAsyncOperation<GattDescriptorsResult> asyncOp,
                                         AsyncStatus status, const std::string uuid,
                                         const std::string serviceId,
                                         const std::string characteristicId)
{
    auto result = asyncOp.GetResults();
    std::vector<std::string> descriptorUuids;

    auto emit = [this, uuid, serviceId, characteristicId, &descriptorUuids](const std::string& err) { 
        auto error = err + " while discovering descriptors for characteristic " + characteristicId;
        mEmit.DescriptorsDiscovered(uuid, serviceId, characteristicId, descriptorUuids, error); 
    };

    CHECK_STATUS_AND_RESULT(status, result, emit);
    
    FOR(descriptor, result.Descriptors())
    {
        descriptorUuids.push_back(toStr(descriptor.Uuid()));
    }
    mEmit.DescriptorsDiscovered(uuid, serviceId, characteristicId, descriptorUuids);
}

bool BLEManager::ReadValue(const std::string& uuid, const winrt::guid& serviceUuid,
                           const winrt::guid& characteristicUuid, const winrt::guid& descriptorUuid)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        peripheral.GetDescriptor(
            serviceUuid, characteristicUuid, descriptorUuid,
            [=](std::optional<GattDescriptor> descriptor) {
                if (descriptor)
                {
                    std::string serviceId = toStr(serviceUuid);
                    std::string characteristicId = toStr(characteristicUuid);
                    std::string descriptorId = toStr(descriptorUuid);
                    auto completed = bind2(this, &BLEManager::OnReadValue, uuid, serviceId,
                                           characteristicId, descriptorId);
                    descriptor->ReadValueAsync(BluetoothCacheMode::Uncached).Completed(completed);
                }
                else
                {
                    LOGE("descriptor not found");
                }
            });
        return true;
    }
}

void BLEManager::OnReadValue(IAsyncOperation<GattReadResult> asyncOp, AsyncStatus status,
                             const std::string uuid, const std::string serviceId,
                             const std::string characteristicId, const std::string descriptorId)
{
    auto result = asyncOp.GetResults();

    auto emit = [this, uuid, serviceId, characteristicId, descriptorId](const std::string& err) { 
        auto error = err + " while reading value of descriptor " + descriptorId;
        mEmit.ReadValue(uuid, serviceId, characteristicId, descriptorId, Data(), error); 
    };

    CHECK_STATUS_AND_RESULT(status, result, emit);

    auto value = result.Value();
    if (value)
    {
        auto reader = DataReader::FromBuffer(value);
        Data data(reader.UnconsumedBufferLength());
        reader.ReadBytes(data);
        mEmit.ReadValue(uuid, serviceId, characteristicId, descriptorId, data);
    }
    else {
        mEmit.ReadValue(uuid, serviceId, characteristicId, descriptorId, Data(), "value is null");
    }
}

bool BLEManager::WriteValue(const std::string& uuid, const winrt::guid& serviceUuid,
                            const winrt::guid& characteristicUuid,
                            const winrt::guid& descriptorUuid, const Data& data)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        auto onDescriptor = [=](std::optional<GattDescriptor> descriptor) {
            if (descriptor)
            {
                std::string serviceId = toStr(serviceUuid);
                std::string characteristicId = toStr(characteristicUuid);
                std::string descriptorId = toStr(descriptorUuid);
                auto writer = DataWriter();
                writer.WriteBytes(data);
                auto value = writer.DetachBuffer();
                auto asyncOp = descriptor->WriteValueWithResultAsync(value);
                asyncOp.Completed(bind2(this, &BLEManager::OnWriteValue, uuid, serviceId,
                                        characteristicId, descriptorId));
            }
            else
            {
                LOGE("descriptor not found");
            }
        };
        peripheral.GetDescriptor(serviceUuid, characteristicUuid, descriptorUuid, onDescriptor);
        return true;
    }
}

void BLEManager::OnWriteValue(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status,
                              const std::string uuid, const std::string serviceId,
                              const std::string characteristicId, const std::string descriptorId)
{
    if (status == AsyncStatus::Completed)
    {
        mEmit.WriteValue(uuid, serviceId, characteristicId, descriptorId);
    }
    else
    {
        std::string error = "status: " + std::to_string((int)status);
        mEmit.WriteValue(uuid, serviceId, characteristicId, descriptorId, error);
    }
}

bool BLEManager::ReadHandle(const std::string& uuid, int handle)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        LOGE("not available");
        return true;
    }
}

void BLEManager::OnReadHandle(IAsyncOperation<GattReadResult> asyncOp, AsyncStatus status,
                              const std::string uuid, const int handle)
{
    auto result = asyncOp.GetResults();
    
    auto emit = [this, uuid, handle](const std::string& err) { 
        auto error = err + " while reading handle " + std::to_string(handle);
        mEmit.ReadHandle(uuid, handle, Data(), error); 
    };

    CHECK_STATUS_AND_RESULT(status, result, emit);
    
    auto value = result.Value();
    if (value)
    {
        auto reader = DataReader::FromBuffer(value);
        Data data(reader.UnconsumedBufferLength());
        reader.ReadBytes(data);
        mEmit.ReadHandle(uuid, handle, data);
    }
    else {
        mEmit.ReadHandle(uuid, handle, Data(), "value is null"); 
    }
}

bool BLEManager::WriteHandle(const std::string& uuid, int handle, Data data)
{
    CHECK_DEVICE();
    IFDEVICE(device, uuid)
    {
        LOGE("not available");
        return true;
    }
}

void BLEManager::OnWriteHandle(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status,
                               const std::string uuid, const int handle)
{
    if (status == AsyncStatus::Completed)
    {
        mEmit.WriteHandle(uuid, handle);
    }
    else
    {
        std::string error = "status: " + std::to_string((int)status);
        mEmit.WriteHandle(uuid, handle, error);
    }
}
