#include "ble_manager.h"
#include "napi_winrt.h"
#include "winrt_cpp.h"

#include <algorithm>
#include <utility>

#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Devices.Bluetooth.h>
#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>
#include <winrt/Windows.Devices.Enumeration.h>


using winrt::Windows::Devices::Enumeration::DevicePairingProtectionLevel;
using winrt::Windows::Devices::Enumeration::DevicePairingResult;
using winrt::Windows::Devices::Enumeration::DevicePairingResultStatus;
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

#define LOGE(message, ...) printf(__FUNCTION__ ": " message "\n", __VA_ARGS__)

// Rejection messages for requests that outlive their link.
static const char* const kDisconnected = "peripheral disconnected";
static const char* const kConnectCanceled = "connection canceled!";

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


// Iterates a WinRT collection; a null collection fails the request.
#define FOR(object, vector, _fail)        \
    auto _vector = vector;                \
    if (!_vector)                         \
    {                                     \
        LOGE(#vector " is null");         \
        _fail(std::string(#vector " is null")); \
        return;                           \
    }                                     \
    else                                  \
        for (auto&& object : _vector)

// GetResults() throws unless the operation completed, so only ask for the
// result then; CHECK_STATUS_AND_RESULT reports the other states.
template <typename T> T resultsOrNull(const IAsyncOperation<T>& asyncOp, AsyncStatus status)
{
    T result{ nullptr };
    if (status == AsyncStatus::Completed)
    {
        result = asyncOp.GetResults();
    }
    return result;
}

static Data readBuffer(const IBuffer& value)
{
    auto reader = DataReader::FromBuffer(value);
    Data data(reader.UnconsumedBufferLength());
    reader.ReadBytes(data);
    return data;
}

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

BLEManager::BLEManager(std::shared_ptr<noble::JsBridge> bridge)
    : mBridge(std::move(bridge)), mAlive(std::make_shared<std::atomic<bool>>(true))
{
    mRadioState = AdapterState::Initial;
    auto onRadio = std::bind(&BLEManager::OnRadio, this, std::placeholders::_1, std::placeholders::_2);
    mWatcher.Start(onRadio);
    mAdvertismentWatcher.ScanningMode(BluetoothLEScanningMode::Active);
    auto onReceived = Bind(&BLEManager::OnScanResult);
    mReceivedRevoker = mAdvertismentWatcher.Received(winrt::auto_revoke, onReceived);
    auto onStopped = Bind(&BLEManager::OnScanStopped);
    mStoppedRevoker = mAdvertismentWatcher.Stopped(winrt::auto_revoke, onStopped);
}

BLEManager::~BLEManager()
{
    // Tell every WinRT handler created by Bind() (and the peripherals' lookup
    // callbacks) that the manager is going away before any member is
    // destroyed; completions that arrive from now on are ignored. The requests
    // they belonged to are rejected by JsBridge::close(), which stop() calls
    // right after this destructor returns.
    mAlive->store(false);

    // Stop delivering advertisements before the members they touch are destroyed.
    mReceivedRevoker.revoke();
    mStoppedRevoker.revoke();
}

// --- request bookkeeping -----------------------------------------------------

void BLEManager::Resolve(noble::RequestId requestId, noble::JsBridge::ValueFactory value)
{
    {
        std::lock_guard<std::mutex> lock(mPendingMutex);
        mPending.erase(requestId);
    }
    mBridge->resolve(requestId, std::move(value));
}

void BLEManager::Reject(noble::RequestId requestId, const std::string& message)
{
    {
        std::lock_guard<std::mutex> lock(mPendingMutex);
        mPending.erase(requestId);
    }
    mBridge->reject(requestId, message);
}

void BLEManager::Track(noble::RequestId requestId, const std::string& uuid, bool isConnect)
{
    std::lock_guard<std::mutex> lock(mPendingMutex);
    mPending[requestId] = PendingRequest{ uuid, isConnect };
}

bool BLEManager::IsPending(noble::RequestId requestId)
{
    std::lock_guard<std::mutex> lock(mPendingMutex);
    return mPending.find(requestId) != mPending.end();
}

void BLEManager::RejectPending(const std::string& uuid, const std::string& message,
                               const std::string& connectMessage)
{
    std::vector<std::pair<noble::RequestId, bool>> requests;
    {
        std::lock_guard<std::mutex> lock(mPendingMutex);
        for (auto it = mPending.begin(); it != mPending.end();)
        {
            if (it->second.uuid == uuid)
            {
                requests.push_back(std::make_pair(it->first, it->second.isConnect));
                it = mPending.erase(it);
            }
            else
            {
                ++it;
            }
        }
    }
    for (const auto& request : requests)
    {
        mBridge->reject(request.first, request.second ? connectMessage : message);
    }
}

PeripheralWinrt* BLEManager::ConnectedPeripheral(noble::RequestId requestId,
                                                 const std::string& uuid)
{
    auto it = mDeviceMap.find(uuid);
    if (it == mDeviceMap.end())
    {
        LOGE("device with id %s not found", uuid.c_str());
        Reject(requestId, "peripheral " + uuid + " not found");
        return nullptr;
    }
    if (!it->second.device.has_value())
    {
        LOGE("device not connected");
        Reject(requestId, "peripheral " + uuid + " is not connected");
        return nullptr;
    }
    Track(requestId, uuid);
    // The peripheral's own (asynchronous) GATT lookups observe the same
    // liveness flag as the handlers created by Bind().
    it->second.managerAlive = mAlive;
    return &it->second;
}

// --- unsolicited activity ----------------------------------------------------

void BLEManager::NotifyDiscover(const std::string& uuid, int rssi, const Peripheral& peripheral)
{
    // Copy the plain advertisement data (not the WinRT handles of a
    // PeripheralWinrt); the object is built later, on the JS thread.
    Peripheral data = peripheral;
    mBridge->notify("onDiscover", [uuid, rssi, data](Napi::Env env) {
        return std::vector<napi_value>{ toDiscoveredPeripheral(env, uuid, rssi, data) };
    });
}

void BLEManager::NotifyDisconnect(const std::string& uuid, const std::string& reason)
{
    mBridge->notify("onDisconnect", [uuid, reason](Napi::Env env) {
        return std::vector<napi_value>{ toUuid(env, uuid), Napi::String::New(env, reason) };
    });
}

void BLEManager::NotifyMtu(const std::string& uuid, int mtu)
{
    mBridge->notify("onMtu", [uuid, mtu](Napi::Env env) {
        return std::vector<napi_value>{ toUuid(env, uuid), Napi::Number::New(env, mtu) };
    });
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
        std::string name = adapterStateToString(state);
        mBridge->notify("onStateChange", [name](Napi::Env env) {
            return std::vector<napi_value>{ Napi::String::New(env, name) };
        });
    }
    if (capabilities.bluetoothAddress > 0)
    {
        std::string address = formatBluetoothAddress(capabilities.bluetoothAddress);
        mBridge->notify("onAddressChange", [address](Napi::Env env) {
            return std::vector<napi_value>{ Napi::String::New(env, address) };
        });
    }
}

// --- scanning ----------------------------------------------------------------

void BLEManager::Scan(noble::RequestId requestId, const std::vector<winrt::guid>& serviceUUIDs,
                      bool allowDuplicates)
{
    Attempt(requestId, "start scanning", [&]() {
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

        // Set before Start(): the watcher may report Stopped (radio off) from
        // another thread before Start() even returns, and that stop must
        // still be reported.
        mScanning.store(true);
        mAdvertismentWatcher.Start();
        mBridge->notify("onScanStart");
        Resolve(requestId);
    });
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
        NotifyDiscover(uuid, rssi, peripheral);
        mDeviceMap.emplace(std::make_pair(uuid, std::move(peripheral)));
    }
    else
    {
        PeripheralWinrt& peripheral = mDeviceMap[uuid];
        peripheral.Update(rssi, args.Advertisement(), advertismentType);
        if (mAllowDuplicates || mAdvertismentMap.find(uuid) == mAdvertismentMap.end())
        {
            mAdvertismentMap.insert(uuid);
            NotifyDiscover(uuid, rssi, peripheral);
        }
    }
}

void BLEManager::StopScan(noble::RequestId requestId)
{
    Attempt(requestId, "stop scanning", [&]() {
        // Queue the request before Stop(): the Stopped event can fire on
        // another thread before Stop() returns.
        {
            std::lock_guard<std::mutex> lock(mPendingMutex);
            mPendingStopScans.push_back(requestId);
        }

        mAdvertismentWatcher.Stop();

        // While the watcher is still `Stopping`, OnScanStopped() settles the
        // request. In every other state (already stopped, aborted, or never
        // started) no Stopped event is coming, so settle it here.
        auto status = mAdvertismentWatcher.Status();
        if (status != BluetoothLEAdvertisementWatcherStatus::Stopping)
        {
            SettleScanStop();
        }
    });
}

void BLEManager::OnScanStopped(BluetoothLEAdvertisementWatcher watcher,
                               const BluetoothLEAdvertisementWatcherStoppedEventArgs& args)
{
    SettleScanStop();
}

// Reports a scan stop exactly once per stop: resolves the stopScanning()
// requests waiting for it and notifies onScanStop. Scanning can also stop on
// its own (e.g. the radio is switched off); then there is nothing to resolve
// and only the notification is sent.
void BLEManager::SettleScanStop()
{
    std::vector<noble::RequestId> requests;
    {
        std::lock_guard<std::mutex> lock(mPendingMutex);
        requests.swap(mPendingStopScans);
    }
    bool wasScanning = mScanning.exchange(false);
    if (wasScanning || !requests.empty())
    {
        mBridge->notify("onScanStop");
    }
    for (auto requestId : requests)
    {
        Resolve(requestId);
    }
}

// --- connection --------------------------------------------------------------

void BLEManager::Connect(noble::RequestId requestId, const std::string& uuid)
{
    Attempt(requestId, "connect", [&]() {
        if (mDeviceMap.find(uuid) == mDeviceMap.end())
        {
            // Convert UUID string to MAC address format
            // Remove any colons if present and convert to uppercase
            std::string cleanUuid = uuid;
            cleanUuid.erase(std::remove(cleanUuid.begin(), cleanUuid.end(), ':'), cleanUuid.end());

            // Basic validation
            if (cleanUuid.length() != 12 ||
                cleanUuid.find_first_not_of("0123456789ABCDEFabcdef") != std::string::npos)
            {
                Reject(requestId, "invalid device address format");
                return;
            }

            try
            {
                // Convert string to uint64_t bluetooth address
                uint64_t bluetoothAddress = std::stoull(cleanUuid, nullptr, 16);

                // Create a new peripheral entry as if it was scanned
                auto peripheral = PeripheralWinrt(bluetoothAddress,
                                                  BluetoothLEAdvertisementType::ConnectableUndirected,
                                                  127,  // default RSSI for direct connect
                                                  BluetoothLEAdvertisement()); // empty advertisement

                // Report the peripheral just like during normal scanning
                NotifyDiscover(uuid, 127, peripheral);

                // Add to device map
                mDeviceMap.emplace(std::make_pair(uuid, std::move(peripheral)));
            }
            catch (const std::exception&)
            {
                Reject(requestId, "invalid device address format");
                return;
            }
        }

        PeripheralWinrt& peripheral = mDeviceMap[uuid];
        if (!peripheral.device.has_value())
        {
            // Tracked as a connect request so cancelConnect() can reject it.
            Track(requestId, uuid, true);
            auto completed = Bind(&BLEManager::OnConnected, requestId, uuid);
            BluetoothLEDevice::FromBluetoothAddressAsync(peripheral.bluetoothAddress)
                .Completed(completed);
        }
        else
        {
            Resolve(requestId);
        }
    });
}

void BLEManager::OnConnected(IAsyncOperation<BluetoothLEDevice> asyncOp, AsyncStatus status,
                             noble::RequestId requestId, const std::string uuid)
{
    Attempt(requestId, "connect", [&]() {
        if (status == AsyncStatus::Completed)
        {
            BluetoothLEDevice device = asyncOp.GetResults();
            // device can be null if the connection failed
            if (device)
            {
                if (!IsPending(requestId))
                {
                    // cancelConnect() / disconnect() already rejected this
                    // request while Windows was still looking for the device:
                    // do not keep a link nobody is waiting for.
                    device.Close();
                    return;
                }

                auto onChanged = Bind(&BLEManager::OnConnectionStatusChanged);
                auto token = device.ConnectionStatusChanged(onChanged);
                auto deviceUuid = formatBluetoothUuid(device.BluetoothAddress());
                PeripheralWinrt& peripheral = mDeviceMap[deviceUuid];
                peripheral.device = device;
                peripheral.connectionToken = token;
                Resolve(requestId);

                // Get GATT session to access the MTU
                auto completed = Bind(&BLEManager::OnGattSessionCreated, deviceUuid);
                GattSession::FromDeviceIdAsync(device.BluetoothDeviceId()).Completed(completed);
            }
            else
            {
                Reject(requestId, "could not connect to device: result is null");
            }
        }
        else
        {
            Reject(requestId, "could not connect to device");
        }
    });
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
            NotifyMtu(uuid, mtu);

            // Subscribe to MTU changes
            auto onPduSizeChanged = Bind(&BLEManager::OnMaxPduSizeChanged, uuid);

            // Store both the session and the event token in the peripheral
            PeripheralWinrt& peripheral = mDeviceMap[uuid];
            peripheral.gattSession = session;
            auto token = session.MaxPduSizeChanged(onPduSizeChanged);
            peripheral.maxPduSizeChangedToken = token;

            session.MaintainConnection(true);
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
    NotifyMtu(uuid, mtu);
}

void BLEManager::Pair(noble::RequestId requestId, const std::string& uuid,
                      winrt::Windows::Devices::Enumeration::DevicePairingKinds kinds,
                      winrt::Windows::Devices::Enumeration::DevicePairingProtectionLevel protectionLevel)
{
    auto it = mDeviceMap.find(uuid);
    if (it == mDeviceMap.end() || !it->second.device.has_value())
    {
        Reject(requestId, "device not connected");
        return;
    }

    BluetoothLEDevice& device = *it->second.device;

    // The complete WinRT pairing sequence runs under one exception boundary.
    // Each of the calls below (device.DeviceInformation().Pairing(),
    // pairing.IsPaired(), pairing.CanPair(), pairing.Custom(), the handler
    // registration, and PairAsync().Completed()) can throw winrt::hresult_error
    // on bad device state, revoked instances, or RPC failure to the enumerator
    // service. A throw from any of them that escapes Pair() would propagate out
    // of the JS binding's QueuedEventRegistration::ForwardByBaton dispatch and
    // tear down the node module — that's the crash we're guarding against.
    // Every exit below settles the request: resolved when the device is (or
    // already was) paired, rejected with the reason otherwise.
    //
    // `custom`, `token`, and `handlerRegistered` are declared before the try so
    // both catch blocks can see them. `custom` is null-initialised because it
    // is reassigned by pairing.Custom() inside the try and must be safe to
    // inspect in the catch. `handlerRegistered` gates the revocation so a throw
    // before the handler is attached cannot dereference an invalid token.
    DeviceInformationCustomPairing custom{nullptr};
    winrt::event_token token{};
    bool handlerRegistered = false;
    try
    {
        auto pairing = device.DeviceInformation().Pairing();

        // Already bonded — report success immediately.
        if (pairing.IsPaired())
        {
            Resolve(requestId);
            return;
        }

        if (!pairing.CanPair())
        {
            Reject(requestId, "device reports it cannot be paired");
            return;
        }

        // These ceremony values are not supported because this library does
        // not collect PIN/password input to forward into an Accept(...) overload.
        constexpr uint32_t unsupportedKinds =
            0x00000040u | 0x00000080u | 0x00000100u;
        if ((static_cast<uint32_t>(kinds) & unsupportedKinds) != 0)
        {
            Reject(requestId, "pairing kinds requiring a PIN or password are not supported");
            return;
        }

        // Always go through `pairing.Custom()`: only DeviceInformationCustomPairing
        // accepts a `DevicePairingKinds` mask (DeviceInformationPairing.PairAsync
        // takes only a protection level). The caller-supplied `kinds` may
        // include ConfirmOnly, DisplayPin, or ConfirmPinMatch; PIN/password
        // ceremonies are rejected before we get here because this library does
        // not provide a way to collect or forward secrets to Accept(...).
        //
        // The PairingRequested lambda must Accept() exactly once for any kind
        // the caller advertised in `kinds`. Some devices negotiated through
        // ConfirmPinMatch can still raise a ConfirmOnly prompt; treat that as a
        // compatible fallback so pairing does not fail with status=Failed.
        // For other kinds outside the mask we return without Accept(), which
        // Windows treats as a rejection and PairAsync completes with
        // RejectedByHandler / AuthenticationNotAllowed. We never forward a PIN
        // or password back to JS — Windows drives the UI for non-ConfirmOnly
        // ceremonies.
        custom = pairing.Custom();
        token = custom.PairingRequested(
            [kinds](winrt::Windows::Devices::Enumeration::DeviceInformationCustomPairing const&,
                winrt::Windows::Devices::Enumeration::DevicePairingRequestedEventArgs const& args) {
                auto kind = args.PairingKind();
                auto kindMask = static_cast<uint32_t>(kind);
                auto requestedKinds = static_cast<uint32_t>(kinds);
                bool confirmPinMatchRequested =
                    (requestedKinds &
                     static_cast<uint32_t>(
                         winrt::Windows::Devices::Enumeration::DevicePairingKinds::ConfirmPinMatch)) != 0;
                bool confirmOnlyFallback =
                    confirmPinMatchRequested &&
                    kind == winrt::Windows::Devices::Enumeration::DevicePairingKinds::ConfirmOnly;
                LOGE("pairing requested, kind=%d", static_cast<int>(kind));
                if ((kindMask & requestedKinds) != 0 || confirmOnlyFallback)
                {
                    args.Accept();
                }
                // Any kind outside the caller's mask: do not call Accept() —
                // Windows treats the handler returning as a rejection.
            });
        handlerRegistered = true;

        // From here on the request is settled by OnPaired(), or rejected if the
        // peripheral disconnects first.
        Track(requestId, uuid);
        auto completed = Bind(&BLEManager::OnPaired, requestId, token, custom);
        custom.PairAsync(kinds, protectionLevel)
            .Completed(completed);
    }
    catch (const winrt::hresult_error& e)
    {
        if (handlerRegistered)
        {
            try { custom.PairingRequested(token); } catch (...) {}
        }
        Reject(requestId, "pairing operation failed: " + winrt::to_string(e.message()));
    }
    catch (const std::exception& e)
    {
        if (handlerRegistered)
        {
            try { custom.PairingRequested(token); } catch (...) {}
        }
        Reject(requestId, std::string("pairing operation failed: ") + e.what());
    }
    catch (...)
    {
        if (handlerRegistered)
        {
            try { custom.PairingRequested(token); } catch (...) {}
        }
        Reject(requestId, "pairing operation failed");
    }
}

std::string pairingResultStatusToString(DevicePairingResultStatus status)
{
    switch (status)
    {
        case DevicePairingResultStatus::Paired: return "Paired";
        case DevicePairingResultStatus::NotReadyToPair: return "NotReadyToPair";
        case DevicePairingResultStatus::NotPaired: return "NotPaired";
        case DevicePairingResultStatus::AlreadyPaired: return "AlreadyPaired";
        case DevicePairingResultStatus::ConnectionRejected: return "ConnectionRejected";
        case DevicePairingResultStatus::TooManyConnections: return "TooManyConnections";
        case DevicePairingResultStatus::HardwareFailure: return "HardwareFailure";
        case DevicePairingResultStatus::AuthenticationTimeout: return "AuthenticationTimeout";
        case DevicePairingResultStatus::AuthenticationNotAllowed: return "AuthenticationNotAllowed";
        case DevicePairingResultStatus::AuthenticationFailure: return "AuthenticationFailure";
        case DevicePairingResultStatus::NoSupportedProfiles: return "NoSupportedProfiles";
        case DevicePairingResultStatus::ProtectionLevelCouldNotBeMet:
            return "ProtectionLevelCouldNotBeMet";
        case DevicePairingResultStatus::AccessDenied: return "AccessDenied";
        case DevicePairingResultStatus::InvalidCeremonyData: return "InvalidCeremonyData";
        case DevicePairingResultStatus::PairingCanceled: return "PairingCanceled";
        case DevicePairingResultStatus::OperationAlreadyInProgress:
            return "OperationAlreadyInProgress";
        case DevicePairingResultStatus::RequiredHandlerNotRegistered:
            return "RequiredHandlerNotRegistered";
        case DevicePairingResultStatus::RejectedByHandler: return "RejectedByHandler";
        case DevicePairingResultStatus::RemoteDeviceHasAssociation:
            return "RemoteDeviceHasAssociation";
        case DevicePairingResultStatus::Failed: return "Failed";
        default:
            return "Unknown(" + std::to_string(static_cast<int>(status)) + ")";
    }
}

void BLEManager::OnPaired(IAsyncOperation<DevicePairingResult> asyncOp, AsyncStatus status,
                          noble::RequestId requestId,
                          winrt::event_token token,
                          winrt::Windows::Devices::Enumeration::DeviceInformationCustomPairing custom)
{
    // Revoke the PairingRequested handler now that pairing has settled; without
    // this, a stray callback (e.g. if the device re-prompts) would call Accept/
    // Reject on already-resolved args and could log confusing messages. Best-effort
    // (guarded like the revocation sites in Pair()): a throw here must not skip
    // settling the pairing request below. This block deliberately stays outside
    // the result-handling try because revocation should always run even when
    // the result itself is unusable.
    try { custom.PairingRequested(token); } catch (...) {}

    // Everything below — status branching, asyncOp.GetResults(), result.Status(),
    // logging that touches the status enum, and settling the request — can throw
    // winrt::hresult_error (revoked asyncOp, marshalling failures) or a standard
    // exception (e.g. formatBluetoothUuid-style misbehaviour surfacing a bad_alloc).
    // A throw escaping OnPaired would propagate through the Completed() handler
    // that JS bindings registered and terminate the node module. Wrap the whole
    // result-handling tail in one try/catch so the consumer always gets a
    // deterministic rejection of the pair() promise.
    try
    {
        if (status != AsyncStatus::Completed)
        {
            Reject(requestId, "pairing operation " + asyncStatusToString(status));
            return;
        }

        auto result = asyncOp.GetResults();
        auto resultStatus = result.Status();
        LOGE("pairing result status=%s", pairingResultStatusToString(resultStatus).c_str());
        if (resultStatus == DevicePairingResultStatus::Paired ||
            resultStatus == DevicePairingResultStatus::AlreadyPaired)
        {
            Resolve(requestId);
        }
        else
        {
            Reject(requestId, "pairing failed with status " + pairingResultStatusToString(resultStatus));
        }
    }
    catch (const winrt::hresult_error& e)
    {
        Reject(requestId, "pairing result failed: " + winrt::to_string(e.message()));
    }
    catch (const std::exception& e)
    {
        Reject(requestId, std::string("pairing result failed: ") + e.what());
    }
    catch (...)
    {
        Reject(requestId, "pairing result failed");
    }
}

// Closes the link (if any) and rejects every request still waiting on the
// peripheral, so no promise outlives its connection.
void BLEManager::DropConnection(const std::string& uuid, const std::string& message,
                                const std::string& connectMessage)
{
    auto it = mDeviceMap.find(uuid);
    if (it != mDeviceMap.end())
    {
        try
        {
            it->second.Disconnect();
        }
        catch (...)
        {
            // Closing an already broken link can throw; the link is gone either way.
            LOGE("closing the connection to %s failed", uuid.c_str());
            it->second.device = std::nullopt;
        }
    }
    mNotifyMap.Remove(uuid);
    RejectPending(uuid, message, connectMessage);
}

void BLEManager::Disconnect(const std::string& uuid)
{
    if (mDeviceMap.find(uuid) == mDeviceMap.end())
    {
        LOGE("device with id %s not found", uuid.c_str());
        return;
    }
    DropConnection(uuid, kDisconnected, kConnectCanceled);
    NotifyDisconnect(uuid, "disconnect requested");
}

void BLEManager::CancelConnect(const std::string& uuid)
{
    if (mDeviceMap.find(uuid) == mDeviceMap.end())
    {
        LOGE("device with id %s not found", uuid.c_str());
        return;
    }
    // A connect() still in flight rejects with 'connection canceled!';
    // OnConnected() then discards the device if Windows still delivers it.
    DropConnection(uuid, kDisconnected, kConnectCanceled);
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
        if (peripheral.device.has_value() && peripheral.device.value() == device)
        {
            DropConnection(uuid, kDisconnected, kConnectCanceled);
            // Windows does not say why the link was lost.
            NotifyDisconnect(uuid, "unknown");
        }
    }
}

void BLEManager::UpdateRSSI(noble::RequestId requestId, const std::string& uuid)
{
    auto it = mDeviceMap.find(uuid);
    if (it == mDeviceMap.end())
    {
        LOGE("device with id %s not found", uuid.c_str());
        Reject(requestId, "peripheral " + uuid + " not found");
        return;
    }

    // no way to get the rssi while we are connected, return the last value of advertisement
    int rssi = it->second.rssi;
    mBridge->notify("onRssi", [uuid, rssi](Napi::Env env) {
        return std::vector<napi_value>{ toUuid(env, uuid), Napi::Number::New(env, rssi) };
    });
    Resolve(requestId, [rssi](Napi::Env env) -> Napi::Value { return Napi::Number::New(env, rssi); });
}

// --- GATT --------------------------------------------------------------------

void BLEManager::DiscoverServices(noble::RequestId requestId, const std::string& uuid,
                                  const std::vector<winrt::guid>& serviceUUIDs)
{
    PeripheralWinrt* peripheral = ConnectedPeripheral(requestId, uuid);
    if (!peripheral)
    {
        return;
    }
    Attempt(requestId, "discovering services", [&]() {
        auto completed = Bind(&BLEManager::OnServicesDiscovered, requestId, uuid, serviceUUIDs);
        peripheral->device->GetGattServicesAsync(BluetoothCacheMode::Uncached).Completed(completed);
    });
}

void BLEManager::OnServicesDiscovered(IAsyncOperation<GattDeviceServicesResult> asyncOp,
                                      AsyncStatus status, noble::RequestId requestId,
                                      const std::string uuid,
                                      const std::vector<winrt::guid> serviceUUIDs)
{
    Attempt(requestId, "discovering services", [&]() {
        if (!IsPending(requestId))
        {
            // The peripheral disconnected meanwhile (the request is already
            // rejected): do not cache services of a dead link.
            return;
        }
        auto result = resultsOrNull(asyncOp, status);
        std::vector<std::string> serviceUuids;

        auto fail = [&](const std::string& err) {
            Reject(requestId, err + " while discovering services");
        };

        CHECK_STATUS_AND_RESULT(status, result, fail);
        PeripheralWinrt& peripheral = mDeviceMap[uuid];
        FOR(service, result.Services(), fail)
        {
            auto id = service.Uuid();
            if (inFilter(serviceUUIDs, id))
            {
                serviceUuids.push_back(toStr(id));
            }
            //remember for cleanup
            peripheral.cachedServices.insert(std::make_pair(id, CachedService(service)));
        }
        Resolve(requestId, [serviceUuids](Napi::Env env) -> Napi::Value {
            return toUuidArray(env, serviceUuids);
        });
    });
}

void BLEManager::DiscoverIncludedServices(noble::RequestId requestId, const std::string& uuid,
                                          const winrt::guid& serviceUuid,
                                          const std::vector<winrt::guid>& serviceUUIDs)
{
    PeripheralWinrt* peripheral = ConnectedPeripheral(requestId, uuid);
    if (!peripheral)
    {
        return;
    }
    Attempt(requestId, "discovering included services", [&]() {
        peripheral->GetService(
            serviceUuid,
            [this, requestId, uuid, serviceUuid, serviceUUIDs](std::optional<GattDeviceService> service) {
                Attempt(requestId, "discovering included services", [&]() {
                    std::string serviceId = toStr(serviceUuid);
                    if (service)
                    {
                        service->GetIncludedServicesAsync(BluetoothCacheMode::Uncached)
                            .Completed(Bind(&BLEManager::OnIncludedServicesDiscovered, requestId,
                                            uuid, serviceId, serviceUUIDs));
                    }
                    else
                    {
                        LOGE("GetService error");
                        Reject(requestId, "service " + serviceId + " not found");
                    }
                });
            });
    });
}

void BLEManager::OnIncludedServicesDiscovered(IAsyncOperation<GattDeviceServicesResult> asyncOp,
                                              AsyncStatus status, noble::RequestId requestId,
                                              const std::string uuid, const std::string serviceId,
                                              const std::vector<winrt::guid> serviceUUIDs)
{
    Attempt(requestId, "discovering included services", [&]() {
        if (!IsPending(requestId))
        {
            // See OnServicesDiscovered().
            return;
        }
        auto result = resultsOrNull(asyncOp, status);
        std::vector<std::string> servicesUuids;

        auto fail = [&](const std::string& err) {
            Reject(requestId,
                   err + " while discovering included services for service " + serviceId);
        };

        CHECK_STATUS_AND_RESULT(status, result, fail);
        PeripheralWinrt& peripheral = mDeviceMap[uuid];
        FOR(service, result.Services(), fail)
        {
            auto id = service.Uuid();
            if (inFilter(serviceUUIDs, id))
            {
                servicesUuids.push_back(toStr(id));
            }
            //remember for cleanup
            peripheral.cachedServices.insert(std::make_pair(id, CachedService(service)));
        }
        Resolve(requestId, [servicesUuids](Napi::Env env) -> Napi::Value {
            return toUuidArray(env, servicesUuids);
        });
    });
}

void BLEManager::DiscoverCharacteristics(noble::RequestId requestId, const std::string& uuid,
                                         const winrt::guid& serviceUuid,
                                         const std::vector<winrt::guid>& characteristicUUIDs)
{
    PeripheralWinrt* peripheral = ConnectedPeripheral(requestId, uuid);
    if (!peripheral)
    {
        return;
    }
    Attempt(requestId, "discovering characteristics", [&]() {
        peripheral->GetService(
            serviceUuid,
            [this, requestId, serviceUuid, characteristicUUIDs](std::optional<GattDeviceService> service) {
                Attempt(requestId, "discovering characteristics", [&]() {
                    std::string serviceId = toStr(serviceUuid);
                    if (service)
                    {
                        service->GetCharacteristicsAsync(BluetoothCacheMode::Uncached)
                            .Completed(Bind(&BLEManager::OnCharacteristicsDiscovered, requestId,
                                            serviceId, characteristicUUIDs));
                    }
                    else
                    {
                        LOGE("GetService error");
                        Reject(requestId, "service " + serviceId + " not found");
                    }
                });
            });
    });
}

void BLEManager::OnCharacteristicsDiscovered(IAsyncOperation<GattCharacteristicsResult> asyncOp,
                                             AsyncStatus status, noble::RequestId requestId,
                                             const std::string serviceId,
                                             const std::vector<winrt::guid> characteristicUUIDs)
{
    Attempt(requestId, "discovering characteristics", [&]() {
        auto result = resultsOrNull(asyncOp, status);
        std::vector<std::pair<std::string, std::vector<std::string>>> characteristicsUuids;

        auto fail = [&](const std::string& err) {
            Reject(requestId, err + " while discovering characteristics for service " + serviceId);
        };

        CHECK_STATUS_AND_RESULT(status, result, fail);
        FOR(characteristic, result.Characteristics(), fail)
        {
            auto id = characteristic.Uuid();
            if (inFilter(characteristicUUIDs, id))
            {
                auto props = characteristic.CharacteristicProperties();
                characteristicsUuids.push_back({ toStr(id), toPropertyArray(props) });
            }
        }
        Resolve(requestId, [characteristicsUuids](Napi::Env env) -> Napi::Value {
            return toCharacteristicArray(env, characteristicsUuids);
        });
    });
}

void BLEManager::Read(noble::RequestId requestId, const std::string& uuid,
                      const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid)
{
    PeripheralWinrt* peripheral = ConnectedPeripheral(requestId, uuid);
    if (!peripheral)
    {
        return;
    }
    Attempt(requestId, "read", [&]() {
        peripheral->GetCharacteristic(
            serviceUuid, characteristicUuid,
            [this, requestId, characteristicUuid](std::optional<GattCharacteristic> characteristic) {
                Attempt(requestId, "read", [&]() {
                    std::string characteristicId = toStr(characteristicUuid);
                    if (characteristic)
                    {
                        characteristic->ReadValueAsync(BluetoothCacheMode::Uncached)
                            .Completed(Bind(&BLEManager::OnRead, requestId, characteristicId));
                    }
                    else
                    {
                        LOGE("GetCharacteristic error");
                        Reject(requestId, "GetCharacteristic error");
                    }
                });
            });
    });
}

void BLEManager::OnRead(IAsyncOperation<GattReadResult> asyncOp, AsyncStatus status,
                        noble::RequestId requestId, const std::string characteristicId)
{
    Attempt(requestId, "read", [&]() {
        auto result = resultsOrNull(asyncOp, status);

        auto fail = [&](const std::string& err) {
            Reject(requestId, err + " while reading characteristic " + characteristicId);
        };

        CHECK_STATUS_AND_RESULT(status, result, fail);

        auto value = result.Value();
        if (value)
        {
            Data data = readBuffer(value);
            Resolve(requestId, [data](Napi::Env env) -> Napi::Value { return toBuffer(env, data); });
        }
        else
        {
            Reject(requestId, "value is null");
        }
    });
}

void BLEManager::Write(noble::RequestId requestId, const std::string& uuid,
                       const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid,
                       const Data& data, bool withoutResponse)
{
    PeripheralWinrt* peripheral = ConnectedPeripheral(requestId, uuid);
    if (!peripheral)
    {
        return;
    }
    Attempt(requestId, "write", [&]() {
        peripheral->GetCharacteristic(
            serviceUuid, characteristicUuid,
            [this, requestId, characteristicUuid, data, withoutResponse](std::optional<GattCharacteristic> characteristic) {
                Attempt(requestId, "write", [&]() {
                    std::string characteristicId = toStr(characteristicUuid);
                    if (characteristic)
                    {
                        auto writer = DataWriter();
                        writer.WriteBytes(data);
                        auto value = writer.DetachBuffer();
                        GattWriteOption option = withoutResponse
                            ? GattWriteOption::WriteWithoutResponse
                            : GattWriteOption::WriteWithResponse;
                        characteristic->WriteValueWithResultAsync(value, option)
                            .Completed(Bind(&BLEManager::OnWrite, requestId, characteristicId));
                    }
                    else
                    {
                        LOGE("GetCharacteristic error");
                        Reject(requestId, "GetCharacteristic error");
                    }
                });
            });
    });
}

void BLEManager::OnWrite(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status,
                         noble::RequestId requestId, const std::string characteristicId)
{
    Attempt(requestId, "write", [&]() {
        auto result = resultsOrNull(asyncOp, status);

        auto fail = [&](const std::string& err) {
            Reject(requestId, err + " while writing characteristic " + characteristicId);
        };

        CHECK_STATUS_AND_RESULT(status, result, fail);
        Resolve(requestId);
    });
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

void BLEManager::Notify(noble::RequestId requestId, const std::string& uuid,
                        const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid,
                        bool on)
{
    PeripheralWinrt* peripheral = ConnectedPeripheral(requestId, uuid);
    if (!peripheral)
    {
        return;
    }
    auto onCharacteristic = [this, requestId, uuid, characteristicUuid, on](std::optional<GattCharacteristic> characteristic) {
        Attempt(requestId, "notify", [&]() {
            std::string characteristicId = toStr(characteristicUuid);
            if (characteristic)
            {
                bool subscribed = mNotifyMap.IsSubscribed(uuid, *characteristic);

                if (on)
                {
                    if (subscribed)
                    {
                        // already listening
                        Resolve(requestId);
                        return;
                    }

                    auto onChanged = Bind(&BLEManager::OnValueChanged, uuid);
                    auto token = characteristic->ValueChanged(onChanged);
                    mNotifyMap.Add(uuid, *characteristic, token);

                    try
                    {
                        auto descriptorValue =
                            GetDescriptorValue(characteristic->CharacteristicProperties());

                        auto completed = Bind(&BLEManager::OnNotify, requestId, *characteristic,
                                              uuid, characteristicId, on);
                        characteristic
                            ->WriteClientCharacteristicConfigurationDescriptorWithResultAsync(
                                descriptorValue)
                            .Completed(completed);
                    }
                    catch (...)
                    {
                        // The subscription never started: forget the handler
                        // again, then let Attempt() reject the request.
                        try { mNotifyMap.Unsubscribe(uuid, *characteristic); } catch (...) {}
                        throw;
                    }
                }
                else
                {
                    if (!subscribed)
                    {
                        // already not listening
                        Resolve(requestId);
                        return;
                    }

                    mNotifyMap.Unsubscribe(uuid, *characteristic);
                    auto descriptorValue =
                        GattClientCharacteristicConfigurationDescriptorValue::None;
                    auto completed = Bind(&BLEManager::OnNotify, requestId, *characteristic, uuid,
                                          characteristicId, on);
                    characteristic
                        ->WriteClientCharacteristicConfigurationDescriptorWithResultAsync(
                            descriptorValue)
                        .Completed(completed);
                }
            }
            else
            {
                LOGE("GetCharacteristic error");
                Reject(requestId, "GetCharacteristic error");
            }
        });
    };
    Attempt(requestId, "notify", [&]() {
        peripheral->GetCharacteristic(serviceUuid, characteristicUuid, onCharacteristic);
    });
}

void BLEManager::OnNotify(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status,
                          noble::RequestId requestId, const GattCharacteristic characteristic,
                          const std::string uuid, const std::string characteristicId,
                          const bool state)
{
    Attempt(requestId, "notify", [&]() {
        auto result = resultsOrNull(asyncOp, status);

        auto fail = [&](const std::string& err) {
            if (state == true)
            {
                // The subscription was not established: stop listening again.
                try { mNotifyMap.Unsubscribe(uuid, characteristic); } catch (...) {}
            }
            Reject(requestId,
                   err + (state ? " while subscribing to characteristic "
                                : " while unsubscribing from characteristic ") +
                       characteristicId);
        };

        CHECK_STATUS_AND_RESULT(status, result, fail);
        Resolve(requestId);
    });
}

void BLEManager::OnValueChanged(GattCharacteristic characteristic,
                                const GattValueChangedEventArgs& args, std::string deviceUuid)
{
    Data data = readBuffer(args.CharacteristicValue());
    auto characteristicUuid = toStr(characteristic.Uuid());
    auto serviceUuid = toStr(characteristic.Service().Uuid());
    mBridge->notify("onNotification",
                    [deviceUuid, serviceUuid, characteristicUuid, data](Napi::Env env) {
                        return std::vector<napi_value>{ toUuid(env, deviceUuid),
                                                        toUuid(env, serviceUuid),
                                                        toUuid(env, characteristicUuid),
                                                        toBuffer(env, data) };
                    });
}

void BLEManager::DiscoverDescriptors(noble::RequestId requestId, const std::string& uuid,
                                     const winrt::guid& serviceUuid,
                                     const winrt::guid& characteristicUuid)
{
    PeripheralWinrt* peripheral = ConnectedPeripheral(requestId, uuid);
    if (!peripheral)
    {
        return;
    }
    Attempt(requestId, "discovering descriptors", [&]() {
        peripheral->GetCharacteristic(
            serviceUuid, characteristicUuid,
            [this, requestId, characteristicUuid](std::optional<GattCharacteristic> characteristic) {
                Attempt(requestId, "discovering descriptors", [&]() {
                    std::string characteristicId = toStr(characteristicUuid);
                    if (characteristic)
                    {
                        auto completed = Bind(&BLEManager::OnDescriptorsDiscovered, requestId,
                                              characteristicId);
                        characteristic->GetDescriptorsAsync(BluetoothCacheMode::Uncached)
                            .Completed(completed);
                    }
                    else
                    {
                        LOGE("GetCharacteristic error");
                        Reject(requestId, "GetCharacteristic error");
                    }
                });
            });
    });
}

void BLEManager::OnDescriptorsDiscovered(IAsyncOperation<GattDescriptorsResult> asyncOp,
                                         AsyncStatus status, noble::RequestId requestId,
                                         const std::string characteristicId)
{
    Attempt(requestId, "discovering descriptors", [&]() {
        auto result = resultsOrNull(asyncOp, status);
        std::vector<std::string> descriptorUuids;

        auto fail = [&](const std::string& err) {
            Reject(requestId,
                   err + " while discovering descriptors for characteristic " + characteristicId);
        };

        CHECK_STATUS_AND_RESULT(status, result, fail);

        FOR(descriptor, result.Descriptors(), fail)
        {
            descriptorUuids.push_back(toStr(descriptor.Uuid()));
        }
        Resolve(requestId, [descriptorUuids](Napi::Env env) -> Napi::Value {
            return toUuidArray(env, descriptorUuids);
        });
    });
}

void BLEManager::ReadValue(noble::RequestId requestId, const std::string& uuid,
                           const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid,
                           const winrt::guid& descriptorUuid)
{
    PeripheralWinrt* peripheral = ConnectedPeripheral(requestId, uuid);
    if (!peripheral)
    {
        return;
    }
    Attempt(requestId, "reading descriptor", [&]() {
        peripheral->GetDescriptor(
            serviceUuid, characteristicUuid, descriptorUuid,
            [this, requestId, descriptorUuid](std::optional<GattDescriptor> descriptor) {
                Attempt(requestId, "reading descriptor", [&]() {
                    std::string descriptorId = toStr(descriptorUuid);
                    if (descriptor)
                    {
                        auto completed = Bind(&BLEManager::OnReadValue, requestId, descriptorId);
                        descriptor->ReadValueAsync(BluetoothCacheMode::Uncached)
                            .Completed(completed);
                    }
                    else
                    {
                        LOGE("descriptor not found");
                        Reject(requestId, "descriptor not found");
                    }
                });
            });
    });
}

void BLEManager::OnReadValue(IAsyncOperation<GattReadResult> asyncOp, AsyncStatus status,
                             noble::RequestId requestId, const std::string descriptorId)
{
    Attempt(requestId, "reading descriptor", [&]() {
        auto result = resultsOrNull(asyncOp, status);

        auto fail = [&](const std::string& err) {
            Reject(requestId, err + " while reading value of descriptor " + descriptorId);
        };

        CHECK_STATUS_AND_RESULT(status, result, fail);

        auto value = result.Value();
        if (value)
        {
            Data data = readBuffer(value);
            Resolve(requestId, [data](Napi::Env env) -> Napi::Value { return toBuffer(env, data); });
        }
        else
        {
            Reject(requestId, "value is null");
        }
    });
}

void BLEManager::WriteValue(noble::RequestId requestId, const std::string& uuid,
                            const winrt::guid& serviceUuid, const winrt::guid& characteristicUuid,
                            const winrt::guid& descriptorUuid, const Data& data)
{
    PeripheralWinrt* peripheral = ConnectedPeripheral(requestId, uuid);
    if (!peripheral)
    {
        return;
    }
    auto onDescriptor = [this, requestId, descriptorUuid, data](std::optional<GattDescriptor> descriptor) {
        Attempt(requestId, "writing descriptor", [&]() {
            std::string descriptorId = toStr(descriptorUuid);
            if (descriptor)
            {
                auto writer = DataWriter();
                writer.WriteBytes(data);
                auto value = writer.DetachBuffer();
                auto asyncOp = descriptor->WriteValueWithResultAsync(value);
                asyncOp.Completed(Bind(&BLEManager::OnWriteValue, requestId, descriptorId));
            }
            else
            {
                LOGE("descriptor not found");
                Reject(requestId, "descriptor not found");
            }
        });
    };
    Attempt(requestId, "writing descriptor", [&]() {
        peripheral->GetDescriptor(serviceUuid, characteristicUuid, descriptorUuid, onDescriptor);
    });
}

void BLEManager::OnWriteValue(IAsyncOperation<GattWriteResult> asyncOp, AsyncStatus status,
                              noble::RequestId requestId, const std::string descriptorId)
{
    Attempt(requestId, "writing descriptor", [&]() {
        auto result = resultsOrNull(asyncOp, status);

        auto fail = [&](const std::string& err) {
            Reject(requestId, err + " while writing value of descriptor " + descriptorId);
        };

        CHECK_STATUS_AND_RESULT(status, result, fail);
        Resolve(requestId);
    });
}

// WinRT has no API to address an attribute by its handle.
void BLEManager::ReadHandle(noble::RequestId requestId, const std::string& uuid, int handle)
{
    if (!ConnectedPeripheral(requestId, uuid))
    {
        return;
    }
    LOGE("not available");
    Reject(requestId, "reading a handle is not available on Windows");
}

void BLEManager::WriteHandle(noble::RequestId requestId, const std::string& uuid, int handle,
                             const Data& data)
{
    if (!ConnectedPeripheral(requestId, uuid))
    {
        return;
    }
    LOGE("not available");
    Reject(requestId, "writing a handle is not available on Windows");
}
