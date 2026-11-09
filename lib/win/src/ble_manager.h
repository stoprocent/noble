#pragma once

#include <napi.h>

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

#include <winrt/Windows.Devices.Bluetooth.Advertisement.h>
#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>
#include <winrt/Windows.Devices.Enumeration.h>

#include "JsBridge.h"
#include "Peripheral.h"
#include "notify_map.h"
#include "peripheral_winrt.h"
#include "radio_watcher.h"

using namespace winrt::Windows::Devices::Bluetooth::GenericAttributeProfile;
using namespace winrt::Windows::Devices::Bluetooth::Advertisement;
using winrt::Windows::Foundation::AsyncStatus;
using winrt::Windows::Foundation::IAsyncOperation;
using winrt::Windows::Foundation::IInspectable;

/**
 * The WinRT side of noble's `Bindings` contract.
 *
 * Every request method takes the `noble::RequestId` of the promise that was
 * handed to JavaScript and settles it exactly once, through `Resolve()` /
 * `Reject()`, from whichever thread the WinRT operation completes on.
 * Unsolicited activity is reported with `JsBridge::notify()`.
 */
class BLEManager {
public:
    // clang-format off
    explicit BLEManager(std::shared_ptr<noble::JsBridge> bridge);
    ~BLEManager();
    BLEManager(const BLEManager&) = delete;
    BLEManager& operator=(const BLEManager&) = delete;

    void Scan(noble::RequestId requestId, const std::vector<winrt::guid>& serviceUUIDs, bool allowDuplicates);
    void StopScan(noble::RequestId requestId);
    void Connect(noble::RequestId requestId, const std::string& uuid);
    void Pair(
        noble::RequestId requestId,
        const std::string& uuid,
        winrt::Windows::Devices::Enumeration::DevicePairingKinds kinds,
        winrt::Windows::Devices::Enumeration::DevicePairingProtectionLevel protectionLevel);
    void Disconnect(const std::string& uuid);
    void CancelConnect(const std::string& uuid);
    void UpdateRSSI(noble::RequestId requestId, const std::string& uuid);
    void DiscoverServices(noble::RequestId requestId, const std::string& uuid, const std::vector<winrt::guid>& serviceUUIDs);
    void DiscoverIncludedServices(noble::RequestId requestId, const std::string& uuid, const winrt::guid& serviceUuid, const std::vector<winrt::guid>& serviceUUIDs);
    void DiscoverCharacteristics(noble::RequestId requestId, const std::string& uuid, const winrt::guid& service, const std::vector<winrt::guid>& characteristicUUIDs);
    void Read(noble::RequestId requestId, const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid);
    void Write(noble::RequestId requestId, const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid, const Data& data, bool withoutResponse);
    void Notify(noble::RequestId requestId, const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid, bool on);
    void DiscoverDescriptors(noble::RequestId requestId, const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid);
    void ReadValue(noble::RequestId requestId, const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid, const winrt::guid& descriptorUuid);
    void WriteValue(noble::RequestId requestId, const std::string& uuid, const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid, const winrt::guid& descriptorUuid, const Data& data);
    void ReadHandle(noble::RequestId requestId, const std::string& uuid, int handle);
    void WriteHandle(noble::RequestId requestId, const std::string& uuid, int handle, const Data& data);
    // clang-format on

private:
    // clang-format off
    void OnRadio(Radio& radio, const AdapterCapabilities& capabilities);
    void OnScanResult(BluetoothLEAdvertisementWatcher watcher, const BluetoothLEAdvertisementReceivedEventArgs& args);
    void OnScanStopped(BluetoothLEAdvertisementWatcher watcher, const BluetoothLEAdvertisementWatcherStoppedEventArgs& args);
    void OnConnected(IAsyncOperation<BluetoothLEDevice> asyncOp, AsyncStatus status, noble::RequestId requestId, std::string uuid);
    void OnPaired(IAsyncOperation<winrt::Windows::Devices::Enumeration::DevicePairingResult> asyncOp, AsyncStatus status, noble::RequestId requestId, winrt::event_token token, winrt::Windows::Devices::Enumeration::DeviceInformationCustomPairing custom);
    void OnConnectionStatusChanged(BluetoothLEDevice device, winrt::Windows::Foundation::IInspectable inspectable);
    void OnGattSessionCreated(IAsyncOperation<GattSession> asyncOp, AsyncStatus status, std::string uuid);
    void OnMaxPduSizeChanged(GattSession session, winrt::Windows::Foundation::IInspectable object, std::string uuid);
    void OnServicesDiscovered(IAsyncOperation<GattDeviceServicesResult> asyncOp, AsyncStatus status, noble::RequestId requestId, std::string uuid, std::vector<winrt::guid> serviceUUIDs);
    void OnIncludedServicesDiscovered(IAsyncOperation<GattDeviceServicesResult> asyncOp, AsyncStatus status, noble::RequestId requestId, std::string uuid, std::string serviceId, std::vector<winrt::guid> serviceUUIDs);
    void OnCharacteristicsDiscovered(IAsyncOperation<GattCharacteristicsResult> asyncOp, AsyncStatus status, noble::RequestId requestId, std::string serviceId, std::vector<winrt::guid> characteristicUUIDs);
    void OnRead(IAsyncOperation<GattReadResult> asyncOp, AsyncStatus status, noble::RequestId requestId, std::string characteristicId);
    void OnWrite(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status, noble::RequestId requestId, std::string characteristicId);
    void OnNotify(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status, noble::RequestId requestId, GattCharacteristic characteristic, std::string uuid, std::string characteristicId, bool state);
    void OnValueChanged(GattCharacteristic chracteristic, const GattValueChangedEventArgs& args, std::string uuid);
    void OnDescriptorsDiscovered(IAsyncOperation<GattDescriptorsResult> asyncOp, AsyncStatus status, noble::RequestId requestId, std::string characteristicId);
    void OnReadValue(IAsyncOperation<GattReadResult> asyncOp, AsyncStatus status, noble::RequestId requestId, std::string descriptorId);
    void OnWriteValue(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status, noble::RequestId requestId, std::string descriptorId);
    // clang-format on

    // --- request bookkeeping -------------------------------------------------

    // Settle a request. Both are safe from any thread and safe to call for a
    // request that was already settled (the bridge drops the second call), so
    // "exactly once" only requires that every code path reaches one of them.
    void Resolve(noble::RequestId requestId, noble::JsBridge::ValueFactory value = nullptr);
    void Reject(noble::RequestId requestId, const std::string& message);

    // Remembers that `requestId` belongs to peripheral `uuid`, so it can be
    // rejected when that peripheral disconnects before the request completes.
    void Track(noble::RequestId requestId, const std::string& uuid, bool isConnect = false);
    bool IsPending(noble::RequestId requestId);
    // Rejects every request still outstanding for `uuid`.
    void RejectPending(const std::string& uuid, const std::string& message, const std::string& connectMessage);

    // Looks up a connected peripheral for a request and tracks the request for
    // it. Rejects the request and returns nullptr when the peripheral is
    // unknown or not connected.
    PeripheralWinrt* ConnectedPeripheral(noble::RequestId requestId, const std::string& uuid);

    // Common tail of every way a link can go away.
    void DropConnection(const std::string& uuid, const std::string& message, const std::string& connectMessage);

    void NotifyDiscover(const std::string& uuid, int rssi, const Peripheral& peripheral);
    void NotifyDisconnect(const std::string& uuid, const std::string& reason);
    void NotifyMtu(const std::string& uuid, int mtu);
    // Resolves the waiting stopScanning() requests and notifies onScanStop.
    void SettleScanStop();

    // Runs `body`; whatever it throws rejects the request instead of escaping
    // into N-API (which would take the process down) or into a WinRT delegate
    // (which would swallow it and leave the promise pending forever).
    template <typename F> void Attempt(noble::RequestId requestId, const char* what, F&& body)
    {
        try
        {
            body();
        }
        catch (const winrt::hresult_error& e)
        {
            Reject(requestId, std::string(what) + " failed: " + winrt::to_string(e.message()));
        }
        catch (const std::exception& e)
        {
            Reject(requestId, std::string(what) + " failed: " + e.what());
        }
        catch (...)
        {
            Reject(requestId, std::string(what) + " failed");
        }
    }

    // Binds a member function as a WinRT event / completion handler. The
    // handler keeps its own copy of the liveness flag and checks it before
    // touching `this`, exactly like RadioWatcher::OnRadioChanged(): WinRT can
    // still deliver a completion after stop() destroyed the manager, and by
    // then every pending request has been rejected by JsBridge::close().
    template <typename M, class... Types> auto Bind(M method, const Types&... args)
    {
        auto alive = mAlive;
        auto bound =
            std::bind(method, this, std::placeholders::_1, std::placeholders::_2, args...);
        return [alive, bound](auto&& first, auto&& second) {
            if (!alive->load())
            {
                return;
            }
            bound(first, second);
        };
    }

    struct PendingRequest
    {
        std::string uuid;
        bool isConnect;
    };

    std::shared_ptr<noble::JsBridge> mBridge;

    // Shared liveness flag observed by late WinRT callbacks; see Bind().
    std::shared_ptr<std::atomic<bool>> mAlive;

    std::mutex mPendingMutex;
    std::unordered_map<noble::RequestId, PendingRequest> mPending;
    std::vector<noble::RequestId> mPendingStopScans;

    bool mAllowDuplicates = false;
    std::atomic<bool> mScanning{ false };

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
