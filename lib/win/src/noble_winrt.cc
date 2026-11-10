#include "noble_winrt.h"
#include "napi_winrt.h"
#include "winrt_cpp.h"

#include <string>

#define THROW(msg)                                                      \
    Napi::TypeError::New(info.Env(), msg).ThrowAsJavaScriptException(); \
    return Napi::Value();

#define ARG1(type1)                                         \
    if (!info[0].Is##type1())                               \
    {                                                       \
        THROW("There should be one argument: (" #type1 ")") \
    }

#define ARG2(type1, type2)                                              \
    if (!info[0].Is##type1() || !info[1].Is##type2())                   \
    {                                                                   \
        THROW("There should be 2 arguments: (" #type1 ", " #type2 ")"); \
    }

#define ARG3(type1, type2, type3)                                                   \
    if (!info[0].Is##type1() || !info[1].Is##type2() || !info[2].Is##type3())       \
    {                                                                               \
        THROW("There should be 3 arguments: (" #type1 ", " #type2 ", " #type3 ")"); \
    }

#define ARG4(type1, type2, type3, type4)                                                        \
    if (!info[0].Is##type1() || !info[1].Is##type2() || !info[2].Is##type3() ||                 \
        !info[3].Is##type4())                                                                   \
    {                                                                                           \
        THROW("There should be 4 arguments: (" #type1 ", " #type2 ", " #type3 ", " #type4 ")"); \
    }

#define ARG5(type1, type2, type3, type4, type5)                                           \
    if (!info[0].Is##type1() || !info[1].Is##type2() || !info[2].Is##type3() ||           \
        !info[3].Is##type4() || !info[4].Is##type5())                                     \
    {                                                                                     \
        THROW("There should be 5 arguments: (" #type1 ", " #type2 ", " #type3 ", " #type4 \
              ", " #type5 ")");                                                           \
    }

// Requests made before start() / after stop() do not throw: they return a
// rejected promise, like any other request that cannot be served.
#define CHECK_STARTED()                                                              \
    if (!manager || !bridge)                                                         \
    {                                                                                \
        return noble::JsBridge::Rejected(info.Env(), "noble is not started");        \
    }

// Creates the request (id + promise) for the current call. Arguments are
// validated and converted BEFORE this, so a TypeError never leaves a request
// behind. `request.first` is handed to the manager, `request.second` returned.
#define REQUEST()                                                                    \
    CHECK_STARTED()                                                                  \
    auto request = bridge->createRequest(info.Env());                                \
    if (request.first == 0)                                                          \
    {                                                                                \
        return request.second;                                                       \
    }

NobleWinrt::NobleWinrt(const Napi::CallbackInfo& info) : ObjectWrap(info)
{
}

// start(delegate)
Napi::Value NobleWinrt::Start(const Napi::CallbackInfo& info)
{
    ARG1(Object)
    if (manager)
    {
        // Already started: start() is idempotent.
        return info.Env().Undefined();
    }

    auto newBridge = noble::JsBridge::Create(info.Env(), info[0].As<Napi::Object>());
    std::string error;
    try
    {
        manager = new BLEManager(newBridge);
    }
    catch (const winrt::hresult_error& e)
    {
        error = "Failed to start the WinRT bindings: " + winrt::to_string(e.message());
    }
    catch (const std::exception& e)
    {
        error = std::string("Failed to start the WinRT bindings: ") + e.what();
    }
    catch (...)
    {
        error = "Failed to start the WinRT bindings";
    }
    if (!manager)
    {
        newBridge->close(info.Env());
        Napi::Error::New(info.Env(), error).ThrowAsJavaScriptException();
        return Napi::Value();
    }
    bridge = newBridge;
    return info.Env().Undefined();
}

Napi::Value NobleWinrt::Stop(const Napi::CallbackInfo& info)
{
    // stop() must be a safe, idempotent teardown. Guard against a null manager
    // (never started, or already stopped) instead of throwing, and never
    // delete a pointer that was never assigned. `manager` is default
    // initialized to nullptr (see noble_winrt.h), so this also protects the
    // "withBindings() then stop() without ever powering on" path that
    // previously deleted an uninitialized pointer and crashed with 0xC0000005.
    if (manager)
    {
        delete manager;
        manager = nullptr;
    }
    // Only after the manager is gone: reject whatever is still pending and
    // release the event-loop keep-alive so the process can exit. WinRT
    // completions that arrive later are dropped by the closed bridge.
    if (bridge)
    {
        bridge->close(info.Env());
        bridge.reset();
    }
    return info.Env().Undefined();
}

// startScanning(serviceUuids, allowDuplicates)
Napi::Value NobleWinrt::Scan(const Napi::CallbackInfo& info)
{
    auto vector = getUuidArray(info[0]);
    // default value false
    auto duplicates = getBool(info[1], false);
    REQUEST()
    manager->Scan(request.first, vector, duplicates);
    return request.second;
}

// stopScanning()
Napi::Value NobleWinrt::StopScan(const Napi::CallbackInfo& info)
{
    REQUEST()
    manager->StopScan(request.first);
    return request.second;
}

// connect(deviceUuid)
Napi::Value NobleWinrt::Connect(const Napi::CallbackInfo& info)
{
    ARG1(String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    REQUEST()
    manager->Connect(request.first, uuid);
    return request.second;
}

// pair(deviceUuid, kinds?, protectionLevel?, pin?)
Napi::Value NobleWinrt::Pair(const Napi::CallbackInfo& info)
{
    ARG1(String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());

    // `kinds` is a DevicePairingKinds bitmask. The JS layer (noble.js) is
    // expected to normalize the value before forwarding here — including
    // rejecting DevicePairingKinds.None — so any default we pick is a
    // belt-and-suspenders backstop, not a primary code path. We default
    // to None (0) rather than ConfirmOnly to surface unexpected callers
    // via the lambda's `(kind & kinds) == 0` check (PairAsync will fail
    // with RejectedByHandler), instead of silently falling through to a
    // ceremony the caller never asked for.
    using winrt::Windows::Devices::Enumeration::DevicePairingKinds;
    using winrt::Windows::Devices::Enumeration::DevicePairingProtectionLevel;
    auto kinds = static_cast<DevicePairingKinds>(
        getUint32(info[1], static_cast<uint32_t>(DevicePairingKinds::None)));
    auto protectionLevel = static_cast<DevicePairingProtectionLevel>(
        getUint32(info[2], static_cast<uint32_t>(DevicePairingProtectionLevel::Encryption)));

    // `pin` is optional: undefined / null (or an absent argument) mean "no
    // PIN". The JS layer only forwards a non-empty string, so an empty one is
    // refused here rather than read as "no PIN": a caller that supplied a PIN
    // asked for authenticated pairing. The value is a secret and is never
    // logged or echoed in an error message.
    std::string pin;
    if (info.Length() > 3 && !info[3].IsUndefined() && !info[3].IsNull())
    {
        if (!info[3].IsString())
        {
            THROW("The optional PIN argument must be a string")
        }
        pin = info[3].As<Napi::String>().Utf8Value();
        if (pin.empty())
        {
            THROW("The optional PIN argument must not be empty")
        }
    }
    REQUEST()
    manager->Pair(request.first, uuid, kinds, protectionLevel, pin);
    return request.second;
}

// isPaired(deviceUuid)
Napi::Value NobleWinrt::IsPaired(const Napi::CallbackInfo& info)
{
    ARG1(String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    REQUEST()
    manager->IsPaired(request.first, uuid);
    return request.second;
}

// disconnect(deviceUuid): completion is reported through onDisconnect
Napi::Value NobleWinrt::Disconnect(const Napi::CallbackInfo& info)
{
    ARG1(String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    if (manager)
    {
        manager->Disconnect(uuid);
    }
    return info.Env().Undefined();
}

// cancelConnect(deviceUuid): a pending connect() rejects with 'connection canceled!'
Napi::Value NobleWinrt::CancelConnect(const Napi::CallbackInfo& info)
{
    ARG1(String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    if (manager)
    {
        manager->CancelConnect(uuid);
    }
    return info.Env().Undefined();
}

// updateRssi(deviceUuid)
Napi::Value NobleWinrt::UpdateRSSI(const Napi::CallbackInfo& info)
{
    ARG1(String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    REQUEST()
    manager->UpdateRSSI(request.first, uuid);
    return request.second;
}

// discoverServices(deviceUuid, uuids)
Napi::Value NobleWinrt::DiscoverServices(const Napi::CallbackInfo& info)
{
    ARG1(String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    std::vector<winrt::guid> uuids = getUuidArray(info[1]);
    REQUEST()
    manager->DiscoverServices(request.first, uuid, uuids);
    return request.second;
}

// discoverIncludedServices(deviceUuid, serviceUuid, serviceUuids)
Napi::Value NobleWinrt::DiscoverIncludedServices(const Napi::CallbackInfo& info)
{
    ARG2(String, String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    auto service = napiToUuid(info[1].As<Napi::String>());
    std::vector<winrt::guid> uuids = getUuidArray(info[2]);
    REQUEST()
    manager->DiscoverIncludedServices(request.first, uuid, service, uuids);
    return request.second;
}

// discoverCharacteristics(deviceUuid, serviceUuid, characteristicUuids)
Napi::Value NobleWinrt::DiscoverCharacteristics(const Napi::CallbackInfo& info)
{
    ARG2(String, String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    auto service = napiToUuid(info[1].As<Napi::String>());
    std::vector<winrt::guid> characteristics = getUuidArray(info[2]);
    REQUEST()
    manager->DiscoverCharacteristics(request.first, uuid, service, characteristics);
    return request.second;
}

// read(deviceUuid, serviceUuid, characteristicUuid)
Napi::Value NobleWinrt::Read(const Napi::CallbackInfo& info)
{
    ARG3(String, String, String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    auto service = napiToUuid(info[1].As<Napi::String>());
    auto characteristic = napiToUuid(info[2].As<Napi::String>());
    REQUEST()
    manager->Read(request.first, uuid, service, characteristic);
    return request.second;
}

// write(deviceUuid, serviceUuid, characteristicUuid, data, withoutResponse)
Napi::Value NobleWinrt::Write(const Napi::CallbackInfo& info)
{
    ARG5(String, String, String, Buffer, Boolean)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    auto service = napiToUuid(info[1].As<Napi::String>());
    auto characteristic = napiToUuid(info[2].As<Napi::String>());
    auto data = napiToData(info[3].As<Napi::Buffer<unsigned char>>());
    auto withoutResponse = info[4].As<Napi::Boolean>().Value();
    REQUEST()
    manager->Write(request.first, uuid, service, characteristic, data, withoutResponse);
    return request.second;
}

// notify(deviceUuid, serviceUuid, characteristicUuid, notify)
Napi::Value NobleWinrt::Notify(const Napi::CallbackInfo& info)
{
    ARG4(String, String, String, Boolean)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    auto service = napiToUuid(info[1].As<Napi::String>());
    auto characteristic = napiToUuid(info[2].As<Napi::String>());
    auto on = info[3].As<Napi::Boolean>().Value();
    REQUEST()
    manager->Notify(request.first, uuid, service, characteristic, on);
    return request.second;
}

// discoverDescriptors(deviceUuid, serviceUuid, characteristicUuid)
Napi::Value NobleWinrt::DiscoverDescriptors(const Napi::CallbackInfo& info)
{
    ARG3(String, String, String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    auto service = napiToUuid(info[1].As<Napi::String>());
    auto characteristic = napiToUuid(info[2].As<Napi::String>());
    REQUEST()
    manager->DiscoverDescriptors(request.first, uuid, service, characteristic);
    return request.second;
}

// readValue(deviceUuid, serviceUuid, characteristicUuid, descriptorUuid)
Napi::Value NobleWinrt::ReadValue(const Napi::CallbackInfo& info)
{
    ARG4(String, String, String, String)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    auto service = napiToUuid(info[1].As<Napi::String>());
    auto characteristic = napiToUuid(info[2].As<Napi::String>());
    auto descriptor = napiToUuid(info[3].As<Napi::String>());
    REQUEST()
    manager->ReadValue(request.first, uuid, service, characteristic, descriptor);
    return request.second;
}

// writeValue(deviceUuid, serviceUuid, characteristicUuid, descriptorUuid, data)
Napi::Value NobleWinrt::WriteValue(const Napi::CallbackInfo& info)
{
    ARG5(String, String, String, String, Buffer)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    auto service = napiToUuid(info[1].As<Napi::String>());
    auto characteristic = napiToUuid(info[2].As<Napi::String>());
    auto descriptor = napiToUuid(info[3].As<Napi::String>());
    auto data = napiToData(info[4].As<Napi::Buffer<unsigned char>>());
    REQUEST()
    manager->WriteValue(request.first, uuid, service, characteristic, descriptor, data);
    return request.second;
}

// readHandle(deviceUuid, handle)
Napi::Value NobleWinrt::ReadHandle(const Napi::CallbackInfo& info)
{
    ARG2(String, Number)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    auto handle = napiToNumber(info[1].As<Napi::Number>());
    REQUEST()
    manager->ReadHandle(request.first, uuid, handle);
    return request.second;
}

// writeHandle(deviceUuid, handle, data, (unused)withoutResponse)
Napi::Value NobleWinrt::WriteHandle(const Napi::CallbackInfo& info)
{
    ARG3(String, Number, Buffer)
    auto uuid = napiToPeripheralId(info[0].As<Napi::String>());
    auto handle = napiToNumber(info[1].As<Napi::Number>());
    auto data = napiToData(info[2].As<Napi::Buffer<unsigned char>>());
    REQUEST()
    manager->WriteHandle(request.first, uuid, handle, data);
    return request.second;
}

// addressToId(address): the peripheral id is the address as lowercase hex
Napi::Value NobleWinrt::AddressToId(const Napi::CallbackInfo& info)
{
    ARG1(String)
    std::string id = napiToPeripheralId(info[0].As<Napi::String>());

    if (id.length() != 12)
    {
        return info.Env().Null();
    }

    if (id.find_first_not_of("0123456789abcdef") != std::string::npos)
    {
        return info.Env().Null();
    }

    return Napi::String::New(info.Env(), id);
}

#pragma comment(lib, "windowsapp")
Napi::Object NobleWinrt::Init(Napi::Env env, Napi::Object exports) {
    Napi::HandleScope scope(env);

    try
    {
        winrt::init_apartment();
    }
    catch (winrt::hresult_error hresult)
    {
        if (hresult.code() != RPC_E_CHANGED_MODE)
        {
            wprintf(L"Failed initializing apartment: %d %s", hresult.code().value,
                    hresult.message().c_str());
            Napi::TypeError::New(env, "Failed initializing apartment").ThrowAsJavaScriptException();
            return exports;
        }
    }

    Napi::Function func = DefineClass(env, "NobleWinrt", {
        NobleWinrt::InstanceMethod("start", &NobleWinrt::Start),
        NobleWinrt::InstanceMethod("stop", &NobleWinrt::Stop),
        NobleWinrt::InstanceMethod("startScanning", &NobleWinrt::Scan),
        NobleWinrt::InstanceMethod("stopScanning", &NobleWinrt::StopScan),
        NobleWinrt::InstanceMethod("connect", &NobleWinrt::Connect),
        NobleWinrt::InstanceMethod("pair", &NobleWinrt::Pair),
        NobleWinrt::InstanceMethod("isPaired", &NobleWinrt::IsPaired),
        NobleWinrt::InstanceMethod("disconnect", &NobleWinrt::Disconnect),
        NobleWinrt::InstanceMethod("cancelConnect", &NobleWinrt::CancelConnect),
        NobleWinrt::InstanceMethod("updateRssi", &NobleWinrt::UpdateRSSI),
        NobleWinrt::InstanceMethod("discoverServices", &NobleWinrt::DiscoverServices),
        NobleWinrt::InstanceMethod("discoverIncludedServices", &NobleWinrt::DiscoverIncludedServices),
        NobleWinrt::InstanceMethod("discoverCharacteristics", &NobleWinrt::DiscoverCharacteristics),
        NobleWinrt::InstanceMethod("read", &NobleWinrt::Read),
        NobleWinrt::InstanceMethod("write", &NobleWinrt::Write),
        NobleWinrt::InstanceMethod("notify", &NobleWinrt::Notify),
        NobleWinrt::InstanceMethod("discoverDescriptors", &NobleWinrt::DiscoverDescriptors),
        NobleWinrt::InstanceMethod("readValue", &NobleWinrt::ReadValue),
        NobleWinrt::InstanceMethod("writeValue", &NobleWinrt::WriteValue),
        NobleWinrt::InstanceMethod("readHandle", &NobleWinrt::ReadHandle),
        NobleWinrt::InstanceMethod("writeHandle", &NobleWinrt::WriteHandle),
        NobleWinrt::InstanceMethod("addressToId", &NobleWinrt::AddressToId),
        });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("NobleWinrt", func);
    return exports;
}

NODE_API_NAMED_ADDON(addon, NobleWinrt);
