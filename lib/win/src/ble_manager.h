#pragma once

#include <winrt/Windows.Devices.Bluetooth.Advertisement.h>
#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>

#include "Emit.h"
#include "notify_map.h"
#include "peripheral_winrt.h"
#include "radio_watcher.h"

using namespace winrt::Windows::Devices::Bluetooth::GenericAttributeProfile;
using namespace winrt::Windows::Devices::Bluetooth::Advertisement;
using winrt::Windows::Foundation::AsyncStatus;
using winrt::Windows::Foundation::IAsyncOperation;
using winrt::Windows::Foundation::IInspectable;

class BLEManager {
public:
    // clang-format off
    BLEManager(const Napi::Value& receiver, const Napi::Function& callback);
    void Scan(const std::vector<winrt::guid>& serviceUUIDs, bool allowDuplicates);
    void StopScan();
    bool Connect(const std::string& uuid);
    bool Disconnect(const std::string& uuid);
    bool CancelConnect(const std::string& uuid);
    bool UpdateRSSI(const std::string& uuid);
    bool DiscoverServices(const std::string& uuid, const std::vector<winrt::guid>& serviceUUIDs);
    bool DiscoverIncludedServices(const std::string& uuid, const winrt::guid& serviceUuid, const std::vector<winrt::guid>& serviceUUIDs);
    bool DiscoverCharacteristics(const std::string& uuid, const winrt::guid& service, const std::vector<winrt::guid>& characteristicUUIDs);
    bool Read(const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid);
    bool Write(const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid, const Data& data, bool withoutResponse);
    bool Notify(const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid, bool on);
    bool DiscoverDescriptors(const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid);
    bool ReadValue(const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid, const winrt::guid& descriptorUuid);
    bool WriteValue(const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid, const winrt::guid& descriptorUuid, const Data& data);
    bool ReadHandle(const std::string& uuid, int handle);
    bool WriteHandle(const std::string& uuid, int handle, Data data);
    // clang-format on

private:
    // clang-format off
    void OnRadio(Radio& radio, const AdapterCapabilities& capabilities);
    void OnScanResult(BluetoothLEAdvertisementWatcher watcher, const BluetoothLEAdvertisementReceivedEventArgs& args);
    void OnScanStopped(BluetoothLEAdvertisementWatcher watcher, const BluetoothLEAdvertisementWatcherStoppedEventArgs& args);
    void OnConnected(IAsyncOperation<BluetoothLEDevice> asyncOp, AsyncStatus status, std::string uuid);
    void OnConnectionStatusChanged(BluetoothLEDevice device, winrt::Windows::Foundation::IInspectable inspectable);
    void OnGattSessionCreated(IAsyncOperation<GattSession> asyncOp, AsyncStatus status, std::string uuid);
    void OnMaxPduSizeChanged(GattSession session, winrt::Windows::Foundation::IInspectable object, std::string uuid);
    void OnServicesDiscovered(IAsyncOperation<GattDeviceServicesResult> asyncOp, AsyncStatus status, std::string uuid, std::vector<winrt::guid> serviceUUIDs);
    void OnIncludedServicesDiscovered(IAsyncOperation<GattDeviceServicesResult> asyncOp, AsyncStatus status, std::string uuid, std::string serviceId, std::vector<winrt::guid> serviceUUIDs);
    void OnCharacteristicsDiscovered(IAsyncOperation<GattCharacteristicsResult> asyncOp, AsyncStatus status, std::string uuid, std::string serviceId, std::vector<winrt::guid> characteristicUUIDs);
    void OnRead(IAsyncOperation<GattReadResult> asyncOp, AsyncStatus status, std::string uuid, std::string serviceId, std::string characteristicId);
    void OnWrite(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status, std::string uuid, std::string serviceId, std::string characteristicId);
    void OnNotify(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status,  GattCharacteristic characteristic, std::string uuid, std::string serviceId, std::string characteristicId, bool state);
    void OnValueChanged(GattCharacteristic chracteristic, const GattValueChangedEventArgs& args, std::string uuid);
    void OnDescriptorsDiscovered(IAsyncOperation<GattDescriptorsResult> asyncOp, AsyncStatus status, std::string uuid, std::string serviceId, std::string characteristicId);
    void OnReadValue(IAsyncOperation<GattReadResult> asyncOp, AsyncStatus status, std::string uuid, std::string serviceId, std::string characteristicId, std::string descriptorId);
    void OnWriteValue(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status, std::string uuid, std::string serviceId, std::string characteristicId, std::string descriptorId);
    void OnReadHandle(IAsyncOperation<GattReadResult> asyncOp, AsyncStatus status, std::string uuid, int handle);
    void OnWriteHandle(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status, std::string uuid, int handle);
    // clang-format on
    
    bool mAllowDuplicates;

    Emit mEmit;
    RadioWatcher mWatcher;
    AdapterState mRadioState;
    BluetoothLEAdvertisementWatcher mAdvertismentWatcher;

    winrt::event_revoker<IBluetoothLEAdvertisementWatcher> mReceivedRevoker;
    winrt::event_revoker<IBluetoothLEAdvertisementWatcher> mStoppedRevoker;

    std::unordered_map<std::string, PeripheralWinrt> mDeviceMap;
    std::vector<winrt::guid> mScanServiceUUIDs;
    std::set<std::string> mAdvertismentMap;
    NotifyMap mNotifyMap;
};
