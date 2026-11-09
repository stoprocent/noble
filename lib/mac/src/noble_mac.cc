// N-API glue for the macOS backend.
//
// This file is deliberately thin and free of Apple headers: all CoreBluetooth
// logic lives in the Swift core (BLEManager.swift and friends). The glue only
//  - exposes the `NobleMac` class implementing noble's `Bindings` contract,
//  - turns JS arguments into plain C values for the Swift entry points, and
//  - turns the results / notifications Swift delivers (from its own dispatch
//    queue) into JS values through the shared JsBridge.

#include <napi.h>

#include <cctype>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "JsBridge.h"
#include "noble_mac_bridge.h"

namespace
{

using noble::JsBridge;
using Bytes = std::vector<uint8_t>;

/// What Swift gets as its opaque `context`. Owned by the NobleMac instance and
/// only freed after noble_mac_destroy() returned, i.e. once Swift is done with it.
struct BridgeContext
{
    std::shared_ptr<JsBridge> bridge;
};

JsBridge& bridgeOf(void* context)
{
    return *static_cast<BridgeContext*>(context)->bridge;
}

// --- C -> C++ copies (Swift's memory is only valid during the call) ---------

std::string copyString(const char* value)
{
    return value ? std::string(value) : std::string();
}

Bytes copyBytes(const uint8_t* data, size_t length)
{
    if (data == nullptr || length == 0)
    {
        return Bytes();
    }
    return Bytes(data, data + length);
}

std::vector<std::string> copyStrings(const char* const* values, size_t count)
{
    std::vector<std::string> result;
    if (values == nullptr)
    {
        return result;
    }
    result.reserve(count);
    for (size_t i = 0; i < count; i++)
    {
        result.push_back(copyString(values[i]));
    }
    return result;
}

// --- C++ -> JS conversions (JS thread only) ---------------------------------

Napi::Value toBuffer(Napi::Env env, const Bytes& data)
{
    if (data.empty())
    {
        return Napi::Buffer<uint8_t>::New(env, 0);
    }
    return Napi::Buffer<uint8_t>::Copy(env, data.data(), data.size());
}

Napi::Array toStringArray(Napi::Env env, const std::vector<std::string>& values)
{
    auto array = Napi::Array::New(env, values.size());
    for (size_t i = 0; i < values.size(); i++)
    {
        array.Set(static_cast<uint32_t>(i), Napi::String::New(env, values[i]));
    }
    return array;
}

/// Names of the CBCharacteristicProperties bits, in the order noble reports them.
std::vector<std::string> propertyNames(uint32_t properties)
{
    static const std::pair<uint32_t, const char*> kNames[] = {
        { 0x01, "broadcast" },
        { 0x02, "read" },
        { 0x04, "writeWithoutResponse" },
        { 0x08, "write" },
        { 0x10, "notify" },
        { 0x20, "indicate" },
        { 0x40, "authenticatedSignedWrites" },
        { 0x80, "extendedProperties" },
        { 0x100, "notifyEncryptionRequired" },
        { 0x200, "indicateEncryptionRequired" },
    };
    std::vector<std::string> names;
    for (const auto& entry : kNames)
    {
        if ((properties & entry.first) == entry.first)
        {
            names.emplace_back(entry.second);
        }
    }
    return names;
}

// --- JS -> C++ argument parsing ---------------------------------------------

bool getString(const Napi::Value& value, std::string& out)
{
    if (!value.IsString())
    {
        return false;
    }
    out = value.As<Napi::String>().Utf8Value();
    return true;
}

/// `undefined` / `null` mean "no filter"; anything else must be an array of strings.
bool getStringList(const Napi::Value& value, std::vector<std::string>& out)
{
    out.clear();
    if (value.IsUndefined() || value.IsNull())
    {
        return true;
    }
    if (!value.IsArray())
    {
        return false;
    }
    auto array = value.As<Napi::Array>();
    uint32_t length = array.Length();
    out.reserve(length);
    for (uint32_t i = 0; i < length; i++)
    {
        std::string item;
        if (!getString(array.Get(i), item))
        {
            return false;
        }
        out.push_back(std::move(item));
    }
    return true;
}

bool getBytes(const Napi::Value& value, Bytes& out)
{
    if (!value.IsBuffer())
    {
        return false;
    }
    auto buffer = value.As<Napi::Buffer<uint8_t>>();
    out = copyBytes(buffer.Data(), buffer.Length());
    return true;
}

/// A missing / nullish flag takes the default; anything else must be a boolean.
bool getOptionalBool(const Napi::Value& value, bool fallback, bool& out)
{
    if (value.IsUndefined() || value.IsNull())
    {
        out = fallback;
        return true;
    }
    if (!value.IsBoolean())
    {
        return false;
    }
    out = value.As<Napi::Boolean>().Value();
    return true;
}

bool getHandle(const Napi::Value& value, int32_t& out)
{
    if (!value.IsNumber())
    {
        return false;
    }
    double number = value.As<Napi::Number>().DoubleValue();
    if (!(number >= 0 && number <= 0xFFFF) || number != static_cast<double>(static_cast<int32_t>(number)))
    {
        return false;
    }
    out = static_cast<int32_t>(number);
    return true;
}

/// A `const char* const*` view over a list of strings, for the Swift entry points.
class CStringList
{
public:
    explicit CStringList(const std::vector<std::string>& values)
    {
        mPointers.reserve(values.size());
        for (const auto& value : values)
        {
            mPointers.push_back(value.c_str());
        }
    }

    const char* const* data() const
    {
        return mPointers.empty() ? nullptr : mPointers.data();
    }

    size_t size() const
    {
        return mPointers.size();
    }

private:
    std::vector<const char*> mPointers;
};

Napi::Value invalidArguments(Napi::Env env, const char* signature)
{
    return JsBridge::Rejected(env, std::string("Invalid arguments, expected ") + signature);
}

Napi::Value throwTypeError(Napi::Env env, const char* signature)
{
    Napi::TypeError::New(env, std::string("Invalid arguments, expected ") + signature)
        .ThrowAsJavaScriptException();
    return env.Undefined();
}

class NobleMac : public Napi::ObjectWrap<NobleMac>
{
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);

    explicit NobleMac(const Napi::CallbackInfo& info);
    ~NobleMac() override;

private:
    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    Napi::Value StartScanning(const Napi::CallbackInfo& info);
    Napi::Value StopScanning(const Napi::CallbackInfo& info);
    Napi::Value AddressToId(const Napi::CallbackInfo& info);
    Napi::Value Connect(const Napi::CallbackInfo& info);
    Napi::Value CancelConnect(const Napi::CallbackInfo& info);
    Napi::Value Disconnect(const Napi::CallbackInfo& info);
    Napi::Value UpdateRssi(const Napi::CallbackInfo& info);
    Napi::Value DiscoverServices(const Napi::CallbackInfo& info);
    Napi::Value DiscoverIncludedServices(const Napi::CallbackInfo& info);
    Napi::Value DiscoverCharacteristics(const Napi::CallbackInfo& info);
    Napi::Value Read(const Napi::CallbackInfo& info);
    Napi::Value Write(const Napi::CallbackInfo& info);
    Napi::Value Notify(const Napi::CallbackInfo& info);
    Napi::Value DiscoverDescriptors(const Napi::CallbackInfo& info);
    Napi::Value ReadValue(const Napi::CallbackInfo& info);
    Napi::Value WriteValue(const Napi::CallbackInfo& info);
    Napi::Value ReadHandle(const Napi::CallbackInfo& info);
    Napi::Value WriteHandle(const Napi::CallbackInfo& info);

    bool running() const
    {
        return mManager != nullptr;
    }

    /// The rejected promise for a request made while the addon is not running.
    Napi::Value notRunning(Napi::Env env) const
    {
        return JsBridge::Rejected(env, mStopped ? "noble is stopped" : "noble is not started");
    }

    /// Tears the Swift core down. Never touches JavaScript, so it is safe from
    /// the destructor and from the environment cleanup hook.
    void destroyManager();

    static void OnEnvironmentCleanup(void* self);

    napi_env mEnv = nullptr;
    bool mStopped = false;
    void* mManager = nullptr;
    std::unique_ptr<BridgeContext> mContext;
};

NobleMac::NobleMac(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NobleMac>(info), mEnv(info.Env())
{
}

NobleMac::~NobleMac()
{
    destroyManager();
}

void NobleMac::destroyManager()
{
    if (mManager != nullptr)
    {
        void* manager = mManager;
        mManager = nullptr;
        napi_remove_env_cleanup_hook(mEnv, &NobleMac::OnEnvironmentCleanup, this);
        // Returns once the Swift queue is idle: nothing uses mContext afterwards.
        noble_mac_destroy(manager);
    }
    mContext.reset();
}

void NobleMac::OnEnvironmentCleanup(void* self)
{
    // The process (or worker) exits without stop(): silence CoreBluetooth
    // before the environment, and with it the bridge, goes away.
    static_cast<NobleMac*>(self)->destroyManager();
}

// start(delegate)
Napi::Value NobleMac::Start(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!info[0].IsObject())
    {
        return throwTypeError(env, "start(delegate: BindingsDelegate)");
    }
    if (running())
    {
        return env.Undefined();
    }

    auto context = std::make_unique<BridgeContext>();
    context->bridge = JsBridge::Create(env, info[0].As<Napi::Object>());
    mContext = std::move(context);
    mStopped = false;
    // The context must be in place first: Swift may report the adapter state
    // from its queue before noble_mac_create() even returns.
    mManager = noble_mac_create(mContext.get());
    napi_add_env_cleanup_hook(mEnv, &NobleMac::OnEnvironmentCleanup, this);
    return env.Undefined();
}

// stop()
Napi::Value NobleMac::Stop(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return env.Undefined();
    }
    // Keep the bridge alive across the teardown so everything still pending is
    // rejected and the event loop is released.
    std::shared_ptr<JsBridge> bridge = mContext->bridge;
    destroyManager();
    mStopped = true;
    bridge->close(env);
    return env.Undefined();
}

// startScanning(serviceUuids, allowDuplicates)
Napi::Value NobleMac::StartScanning(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::vector<std::string> serviceUuids;
    bool allowDuplicates = false;
    if (!getStringList(info[0], serviceUuids) || !getOptionalBool(info[1], false, allowDuplicates))
    {
        return invalidArguments(env, "startScanning(serviceUuids: string[], allowDuplicates: boolean)");
    }
    auto request = mContext->bridge->createRequest(env);
    CStringList list(serviceUuids);
    noble_mac_start_scanning(mManager, request.first, list.data(), list.size(), allowDuplicates);
    return request.second;
}

// stopScanning()
Napi::Value NobleMac::StopScanning(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_stop_scanning(mManager, request.first);
    return request.second;
}

// addressToId(address): CoreBluetooth has no MAC addresses, only peripheral
// UUIDs. A dashed UUID is accepted and normalised; anything else is unknown.
Napi::Value NobleMac::AddressToId(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    std::string address;
    if (!getString(info[0], address))
    {
        return throwTypeError(env, "addressToId(address: string)");
    }
    // 8-4-4-4-12 hex digits.
    if (address.size() != 36)
    {
        return env.Null();
    }
    std::string id;
    id.reserve(32);
    for (size_t i = 0; i < address.size(); i++)
    {
        unsigned char c = static_cast<unsigned char>(address[i]);
        if (i == 8 || i == 13 || i == 18 || i == 23)
        {
            if (c != '-')
            {
                return env.Null();
            }
        }
        else if (std::isxdigit(c))
        {
            id.push_back(static_cast<char>(std::tolower(c)));
        }
        else
        {
            return env.Null();
        }
    }
    return Napi::String::New(env, id);
}

// connect(peripheralId, options?) - the options are HCI-only and ignored here.
Napi::Value NobleMac::Connect(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    if (!getString(info[0], peripheralId))
    {
        return invalidArguments(env, "connect(peripheralId: string)");
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_connect(mManager, request.first, peripheralId.c_str());
    return request.second;
}

// cancelConnect(peripheralId)
Napi::Value NobleMac::CancelConnect(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    std::string peripheralId;
    if (!getString(info[0], peripheralId))
    {
        return throwTypeError(env, "cancelConnect(peripheralId: string)");
    }
    if (running())
    {
        noble_mac_cancel_connect(mManager, peripheralId.c_str());
    }
    return env.Undefined();
}

// disconnect(peripheralId)
Napi::Value NobleMac::Disconnect(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    std::string peripheralId;
    if (!getString(info[0], peripheralId))
    {
        return throwTypeError(env, "disconnect(peripheralId: string)");
    }
    if (running())
    {
        noble_mac_disconnect(mManager, peripheralId.c_str());
    }
    return env.Undefined();
}

// updateRssi(peripheralId)
Napi::Value NobleMac::UpdateRssi(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    if (!getString(info[0], peripheralId))
    {
        return invalidArguments(env, "updateRssi(peripheralId: string)");
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_update_rssi(mManager, request.first, peripheralId.c_str());
    return request.second;
}

// discoverServices(peripheralId, serviceUuids)
Napi::Value NobleMac::DiscoverServices(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    std::vector<std::string> serviceUuids;
    if (!getString(info[0], peripheralId) || !getStringList(info[1], serviceUuids))
    {
        return invalidArguments(env, "discoverServices(peripheralId: string, serviceUuids: string[])");
    }
    auto request = mContext->bridge->createRequest(env);
    CStringList list(serviceUuids);
    noble_mac_discover_services(mManager, request.first, peripheralId.c_str(), list.data(), list.size());
    return request.second;
}

// discoverIncludedServices(peripheralId, serviceUuid, serviceUuids)
Napi::Value NobleMac::DiscoverIncludedServices(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    std::string serviceUuid;
    std::vector<std::string> serviceUuids;
    if (!getString(info[0], peripheralId) || !getString(info[1], serviceUuid) ||
        !getStringList(info[2], serviceUuids))
    {
        return invalidArguments(
            env, "discoverIncludedServices(peripheralId: string, serviceUuid: string, serviceUuids: string[])");
    }
    auto request = mContext->bridge->createRequest(env);
    CStringList list(serviceUuids);
    noble_mac_discover_included_services(mManager, request.first, peripheralId.c_str(), serviceUuid.c_str(),
                                         list.data(), list.size());
    return request.second;
}

// discoverCharacteristics(peripheralId, serviceUuid, characteristicUuids)
Napi::Value NobleMac::DiscoverCharacteristics(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    std::string serviceUuid;
    std::vector<std::string> characteristicUuids;
    if (!getString(info[0], peripheralId) || !getString(info[1], serviceUuid) ||
        !getStringList(info[2], characteristicUuids))
    {
        return invalidArguments(
            env,
            "discoverCharacteristics(peripheralId: string, serviceUuid: string, characteristicUuids: string[])");
    }
    auto request = mContext->bridge->createRequest(env);
    CStringList list(characteristicUuids);
    noble_mac_discover_characteristics(mManager, request.first, peripheralId.c_str(), serviceUuid.c_str(),
                                       list.data(), list.size());
    return request.second;
}

// read(peripheralId, serviceUuid, characteristicUuid)
Napi::Value NobleMac::Read(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    std::string serviceUuid;
    std::string characteristicUuid;
    if (!getString(info[0], peripheralId) || !getString(info[1], serviceUuid) ||
        !getString(info[2], characteristicUuid))
    {
        return invalidArguments(env, "read(peripheralId: string, serviceUuid: string, characteristicUuid: string)");
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_read(mManager, request.first, peripheralId.c_str(), serviceUuid.c_str(),
                   characteristicUuid.c_str());
    return request.second;
}

// write(peripheralId, serviceUuid, characteristicUuid, data, withoutResponse)
Napi::Value NobleMac::Write(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    std::string serviceUuid;
    std::string characteristicUuid;
    Bytes data;
    bool withoutResponse = false;
    if (!getString(info[0], peripheralId) || !getString(info[1], serviceUuid) ||
        !getString(info[2], characteristicUuid) || !getBytes(info[3], data) ||
        !getOptionalBool(info[4], false, withoutResponse))
    {
        return invalidArguments(env, "write(peripheralId: string, serviceUuid: string, "
                                     "characteristicUuid: string, data: Buffer, withoutResponse: boolean)");
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_write(mManager, request.first, peripheralId.c_str(), serviceUuid.c_str(),
                    characteristicUuid.c_str(), data.data(), data.size(), withoutResponse);
    return request.second;
}

// notify(peripheralId, serviceUuid, characteristicUuid, notify)
Napi::Value NobleMac::Notify(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    std::string serviceUuid;
    std::string characteristicUuid;
    if (!getString(info[0], peripheralId) || !getString(info[1], serviceUuid) ||
        !getString(info[2], characteristicUuid) || !info[3].IsBoolean())
    {
        return invalidArguments(env, "notify(peripheralId: string, serviceUuid: string, "
                                     "characteristicUuid: string, notify: boolean)");
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_notify(mManager, request.first, peripheralId.c_str(), serviceUuid.c_str(),
                     characteristicUuid.c_str(), info[3].As<Napi::Boolean>().Value());
    return request.second;
}

// discoverDescriptors(peripheralId, serviceUuid, characteristicUuid)
Napi::Value NobleMac::DiscoverDescriptors(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    std::string serviceUuid;
    std::string characteristicUuid;
    if (!getString(info[0], peripheralId) || !getString(info[1], serviceUuid) ||
        !getString(info[2], characteristicUuid))
    {
        return invalidArguments(
            env, "discoverDescriptors(peripheralId: string, serviceUuid: string, characteristicUuid: string)");
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_discover_descriptors(mManager, request.first, peripheralId.c_str(), serviceUuid.c_str(),
                                   characteristicUuid.c_str());
    return request.second;
}

// readValue(peripheralId, serviceUuid, characteristicUuid, descriptorUuid)
Napi::Value NobleMac::ReadValue(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    std::string serviceUuid;
    std::string characteristicUuid;
    std::string descriptorUuid;
    if (!getString(info[0], peripheralId) || !getString(info[1], serviceUuid) ||
        !getString(info[2], characteristicUuid) || !getString(info[3], descriptorUuid))
    {
        return invalidArguments(env, "readValue(peripheralId: string, serviceUuid: string, "
                                     "characteristicUuid: string, descriptorUuid: string)");
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_read_value(mManager, request.first, peripheralId.c_str(), serviceUuid.c_str(),
                         characteristicUuid.c_str(), descriptorUuid.c_str());
    return request.second;
}

// writeValue(peripheralId, serviceUuid, characteristicUuid, descriptorUuid, data)
Napi::Value NobleMac::WriteValue(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    std::string serviceUuid;
    std::string characteristicUuid;
    std::string descriptorUuid;
    Bytes data;
    if (!getString(info[0], peripheralId) || !getString(info[1], serviceUuid) ||
        !getString(info[2], characteristicUuid) || !getString(info[3], descriptorUuid) ||
        !getBytes(info[4], data))
    {
        return invalidArguments(env, "writeValue(peripheralId: string, serviceUuid: string, "
                                     "characteristicUuid: string, descriptorUuid: string, data: Buffer)");
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_write_value(mManager, request.first, peripheralId.c_str(), serviceUuid.c_str(),
                          characteristicUuid.c_str(), descriptorUuid.c_str(), data.data(), data.size());
    return request.second;
}

// readHandle(peripheralId, handle)
Napi::Value NobleMac::ReadHandle(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    int32_t handle = 0;
    if (!getString(info[0], peripheralId) || !getHandle(info[1], handle))
    {
        return invalidArguments(env, "readHandle(peripheralId: string, handle: number)");
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_read_handle(mManager, request.first, peripheralId.c_str(), handle);
    return request.second;
}

// writeHandle(peripheralId, handle, data, withoutResponse)
Napi::Value NobleMac::WriteHandle(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!running())
    {
        return notRunning(env);
    }
    std::string peripheralId;
    int32_t handle = 0;
    Bytes data;
    bool withoutResponse = false;
    if (!getString(info[0], peripheralId) || !getHandle(info[1], handle) || !getBytes(info[2], data) ||
        !getOptionalBool(info[3], false, withoutResponse))
    {
        return invalidArguments(
            env, "writeHandle(peripheralId: string, handle: number, data: Buffer, withoutResponse: boolean)");
    }
    auto request = mContext->bridge->createRequest(env);
    noble_mac_write_handle(mManager, request.first, peripheralId.c_str(), handle, data.data(), data.size(),
                           withoutResponse);
    return request.second;
}

Napi::Object NobleMac::Init(Napi::Env env, Napi::Object exports)
{
    Napi::HandleScope scope(env);

    Napi::Function constructor = DefineClass(env, "NobleMac", {
        InstanceMethod("start", &NobleMac::Start),
        InstanceMethod("stop", &NobleMac::Stop),
        InstanceMethod("startScanning", &NobleMac::StartScanning),
        InstanceMethod("stopScanning", &NobleMac::StopScanning),
        InstanceMethod("addressToId", &NobleMac::AddressToId),
        InstanceMethod("connect", &NobleMac::Connect),
        InstanceMethod("cancelConnect", &NobleMac::CancelConnect),
        InstanceMethod("disconnect", &NobleMac::Disconnect),
        InstanceMethod("updateRssi", &NobleMac::UpdateRssi),
        InstanceMethod("discoverServices", &NobleMac::DiscoverServices),
        InstanceMethod("discoverIncludedServices", &NobleMac::DiscoverIncludedServices),
        InstanceMethod("discoverCharacteristics", &NobleMac::DiscoverCharacteristics),
        InstanceMethod("read", &NobleMac::Read),
        InstanceMethod("write", &NobleMac::Write),
        InstanceMethod("notify", &NobleMac::Notify),
        InstanceMethod("discoverDescriptors", &NobleMac::DiscoverDescriptors),
        InstanceMethod("readValue", &NobleMac::ReadValue),
        InstanceMethod("writeValue", &NobleMac::WriteValue),
        InstanceMethod("readHandle", &NobleMac::ReadHandle),
        InstanceMethod("writeHandle", &NobleMac::WriteHandle),
    });

    exports.Set("NobleMac", constructor);
    return exports;
}

Napi::Object InitAddon(Napi::Env env, Napi::Object exports)
{
    return NobleMac::Init(env, exports);
}

} // namespace

// ---------------------------------------------------------------------------
// Results and notifications, called by Swift from its dispatch queue. Every
// pointer is copied here; JS values are only built later, on the JS thread,
// inside the bridge's factories.
// ---------------------------------------------------------------------------

extern "C"
{

void noble_mac_resolve_void(void* context, uint64_t requestId)
{
    bridgeOf(context).resolve(requestId);
}

void noble_mac_resolve_number(void* context, uint64_t requestId, int32_t value)
{
    bridgeOf(context).resolve(requestId, [value](Napi::Env env) -> Napi::Value {
        return Napi::Number::New(env, value);
    });
}

void noble_mac_resolve_data(void* context, uint64_t requestId, const uint8_t* data, size_t length)
{
    bridgeOf(context).resolve(requestId, [bytes = copyBytes(data, length)](Napi::Env env) -> Napi::Value {
        return toBuffer(env, bytes);
    });
}

void noble_mac_resolve_strings(void* context, uint64_t requestId, const char* const* values, size_t count)
{
    bridgeOf(context).resolve(requestId, [strings = copyStrings(values, count)](Napi::Env env) -> Napi::Value {
        return toStringArray(env, strings);
    });
}

void noble_mac_resolve_characteristics(void* context, uint64_t requestId,
                                       const NobleMacCharacteristic* characteristics, size_t count)
{
    std::vector<std::pair<std::string, uint32_t>> copies;
    if (characteristics != nullptr)
    {
        copies.reserve(count);
        for (size_t i = 0; i < count; i++)
        {
            copies.emplace_back(copyString(characteristics[i].uuid), characteristics[i].properties);
        }
    }
    bridgeOf(context).resolve(requestId, [copies = std::move(copies)](Napi::Env env) -> Napi::Value {
        auto array = Napi::Array::New(env, copies.size());
        for (size_t i = 0; i < copies.size(); i++)
        {
            auto characteristic = Napi::Object::New(env);
            characteristic.Set("uuid", Napi::String::New(env, copies[i].first));
            characteristic.Set("properties", toStringArray(env, propertyNames(copies[i].second)));
            array.Set(static_cast<uint32_t>(i), characteristic);
        }
        return array;
    });
}

void noble_mac_reject(void* context, uint64_t requestId, const char* message)
{
    std::string text = copyString(message);
    bridgeOf(context).reject(requestId, text.empty() ? std::string("unknown error") : text);
}

void noble_mac_on_state_change(void* context, const char* state)
{
    bridgeOf(context).notify("onStateChange", [state = copyString(state)](Napi::Env env) {
        return std::vector<napi_value>{ Napi::String::New(env, state) };
    });
}

void noble_mac_on_scan_start(void* context, bool filterDuplicates)
{
    bridgeOf(context).notify("onScanStart", [filterDuplicates](Napi::Env env) {
        return std::vector<napi_value>{ Napi::Boolean::New(env, filterDuplicates) };
    });
}

void noble_mac_on_scan_stop(void* context)
{
    bridgeOf(context).notify("onScanStop");
}

void noble_mac_on_discover(void* context, const NobleMacDiscovery* discovery)
{
    if (discovery == nullptr)
    {
        return;
    }

    struct Discovery
    {
        std::string id;
        std::string address;
        std::string addressType;
        bool connectable = false;
        bool hasLocalName = false;
        std::string localName;
        bool hasTxPowerLevel = false;
        int32_t txPowerLevel = 0;
        bool hasManufacturerData = false;
        Bytes manufacturerData;
        std::vector<std::pair<std::string, Bytes>> serviceData;
        std::vector<std::string> serviceUuids;
        int32_t rssi = 0;
    };

    Discovery copy;
    copy.id = copyString(discovery->peripheralId);
    copy.address = copyString(discovery->address);
    copy.addressType = copyString(discovery->addressType);
    copy.connectable = discovery->connectable;
    copy.hasLocalName = discovery->localName != nullptr;
    copy.localName = copyString(discovery->localName);
    copy.hasTxPowerLevel = discovery->hasTxPowerLevel;
    copy.txPowerLevel = discovery->txPowerLevel;
    copy.hasManufacturerData = discovery->hasManufacturerData;
    copy.manufacturerData = copyBytes(discovery->manufacturerData, discovery->manufacturerDataLength);
    if (discovery->serviceData != nullptr)
    {
        copy.serviceData.reserve(discovery->serviceDataCount);
        for (size_t i = 0; i < discovery->serviceDataCount; i++)
        {
            const NobleMacServiceData& entry = discovery->serviceData[i];
            copy.serviceData.emplace_back(copyString(entry.uuid), copyBytes(entry.data, entry.length));
        }
    }
    copy.serviceUuids = copyStrings(discovery->serviceUuids, discovery->serviceUuidCount);
    copy.rssi = discovery->rssi;

    bridgeOf(context).notify("onDiscover", [copy = std::move(copy)](Napi::Env env) {
        auto advertisement = Napi::Object::New(env);
        advertisement.Set("localName",
                          copy.hasLocalName ? Napi::Value(Napi::String::New(env, copy.localName)) : env.Null());
        advertisement.Set("txPowerLevel",
                          copy.hasTxPowerLevel ? Napi::Value(Napi::Number::New(env, copy.txPowerLevel))
                                               : env.Null());
        advertisement.Set("manufacturerData",
                          copy.hasManufacturerData ? toBuffer(env, copy.manufacturerData) : env.Null());

        auto serviceData = Napi::Array::New(env, copy.serviceData.size());
        for (size_t i = 0; i < copy.serviceData.size(); i++)
        {
            auto entry = Napi::Object::New(env);
            entry.Set("uuid", Napi::String::New(env, copy.serviceData[i].first));
            entry.Set("data", toBuffer(env, copy.serviceData[i].second));
            serviceData.Set(static_cast<uint32_t>(i), entry);
        }
        advertisement.Set("serviceData", serviceData);
        advertisement.Set("serviceUuids", toStringArray(env, copy.serviceUuids));

        auto peripheral = Napi::Object::New(env);
        peripheral.Set("id", Napi::String::New(env, copy.id));
        peripheral.Set("address", Napi::String::New(env, copy.address));
        peripheral.Set("addressType", Napi::String::New(env, copy.addressType));
        peripheral.Set("connectable", Napi::Boolean::New(env, copy.connectable));
        peripheral.Set("advertisement", advertisement);
        peripheral.Set("rssi", Napi::Number::New(env, copy.rssi));
        return std::vector<napi_value>{ peripheral };
    });
}

void noble_mac_on_connect(void* context, const char* peripheralId)
{
    bridgeOf(context).notify("onConnect", [id = copyString(peripheralId)](Napi::Env env) {
        return std::vector<napi_value>{ Napi::String::New(env, id) };
    });
}

void noble_mac_on_disconnect(void* context, const char* peripheralId, const char* reason)
{
    std::string text = copyString(reason);
    if (text.empty())
    {
        text = "unknown";
    }
    bridgeOf(context).notify("onDisconnect",
                             [id = copyString(peripheralId), text = std::move(text)](Napi::Env env) {
        return std::vector<napi_value>{ Napi::String::New(env, id), Napi::String::New(env, text) };
    });
}

void noble_mac_on_mtu(void* context, const char* peripheralId, int32_t mtu)
{
    bridgeOf(context).notify("onMtu", [id = copyString(peripheralId), mtu](Napi::Env env) {
        return std::vector<napi_value>{ Napi::String::New(env, id), Napi::Number::New(env, mtu) };
    });
}

void noble_mac_on_rssi(void* context, const char* peripheralId, int32_t rssi)
{
    bridgeOf(context).notify("onRssi", [id = copyString(peripheralId), rssi](Napi::Env env) {
        return std::vector<napi_value>{ Napi::String::New(env, id), Napi::Number::New(env, rssi) };
    });
}

void noble_mac_on_notification(void* context, const char* peripheralId, const char* serviceUuid,
                               const char* characteristicUuid, const uint8_t* data, size_t length)
{
    bridgeOf(context).notify("onNotification",
                             [id = copyString(peripheralId), service = copyString(serviceUuid),
                              characteristic = copyString(characteristicUuid),
                              bytes = copyBytes(data, length)](Napi::Env env) {
        return std::vector<napi_value>{ Napi::String::New(env, id), Napi::String::New(env, service),
                                        Napi::String::New(env, characteristic), toBuffer(env, bytes) };
    });
}

} // extern "C"

NODE_API_MODULE(addon, InitAddon)
