#include "noble_mac.h"
#include "napi_objc.h"

#define THROW(msg) \
Napi::TypeError::New(info.Env(), msg).ThrowAsJavaScriptException(); \
return Napi::Value();

#define ARG1(type1) \
if (!info[0].Is##type1()) { \
    THROW("There should be one argument: (" #type1 ")") \
}

#define ARG2(type1, type2) \
if (!info[0].Is##type1() || !info[1].Is##type2()) { \
    THROW("There should be 2 arguments: (" #type1 ", " #type2 ")"); \
}

#define ARG3(type1, type2, type3) \
if (!info[0].Is##type1() || !info[1].Is##type2() || !info[2].Is##type3()) { \
    THROW("There should be 3 arguments: (" #type1 ", " #type2 ", " #type3 ")"); \
}

#define ARG4(type1, type2, type3, type4) \
if (!info[0].Is##type1() || !info[1].Is##type2() || !info[2].Is##type3() || !info[3].Is##type4()) { \
    THROW("There should be 4 arguments: (" #type1 ", " #type2 ", " #type3 ", " #type4 ")"); \
}

#define ARG5(type1, type2, type3, type4, type5) \
if (!info[0].Is##type1() || !info[1].Is##type2() || !info[2].Is##type3() || !info[3].Is##type4() || !info[4].Is##type5()) { \
    THROW("There should be 5 arguments: (" #type1 ", " #type2 ", " #type3 ", " #type4 ", " #type5 ")"); \
}

#define CHECK_MANAGER() \
if(!manager) { \
    THROW(std::string(__FUNCTION__) + ": BLEManager has already been cleaned up"); \
}

NobleMac::NobleMac(const Napi::CallbackInfo& info) : ObjectWrap(info) {}

Napi::Value NobleMac::Start(const Napi::CallbackInfo& info) 
{
    Napi::Function emit = info.This().As<Napi::Object>().Get("emit").As<Napi::Function>();
    manager = [[BLEManager alloc] init:info.This() with:emit];
    return Napi::Value();
}

Napi::Value NobleMac::Stop(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    CFRelease((__bridge CFTypeRef)manager);
    manager = nil;
    return info.Env().Undefined();
}

// startScanning(serviceUuids, allowDuplicates)
Napi::Value NobleMac::Scan(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    NSArray* array = getUuidArray(info[0]);
    // default value NO
    auto duplicates = getBool(info[1], NO);
    [manager scan:array allowDuplicates:duplicates];
    return info.Env().Undefined();
}

// stopScanning()
Napi::Value NobleMac::StopScan(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    [manager stopScan];
    return info.Env().Undefined();
}

// connect(deviceUuid)
Napi::Value NobleMac::Connect(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG1(String)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    [manager connect:uuid];
    return info.Env().Undefined();
}

// disconnect(deviceUuid)
Napi::Value NobleMac::Disconnect(const Napi::CallbackInfo& info)
{
    CHECK_MANAGER()
    ARG1(String)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    [manager disconnect:uuid];
    return info.Env().Undefined();
}

// cancelConnect(deviceUuid)
Napi::Value NobleMac::CancelConnect(const Napi::CallbackInfo& info)
{
    CHECK_MANAGER()
    ARG1(String)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    [manager disconnect:uuid];
    return info.Env().Undefined();
}

// updateRssi(deviceUuid)
Napi::Value NobleMac::UpdateRSSI(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG1(String)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    [manager updateRSSI:uuid];
    return info.Env().Undefined();
}

// discoverServices(deviceUuid, uuids)
Napi::Value NobleMac::DiscoverServices(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG1(String)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    NSArray* array = getUuidArray(info[1]);
    [manager discoverServices:uuid serviceUuids:array];
    return info.Env().Undefined();
}

// discoverIncludedServices(deviceUuid, serviceUuid, serviceUuids)
Napi::Value NobleMac::DiscoverIncludedServices(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG2(String, String)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    auto service = napiToUuidString(info[1].As<Napi::String>());
    NSArray* serviceUuids = getUuidArray(info[2]);
    [manager discoverIncludedServices:uuid forService:service services:serviceUuids];
    return info.Env().Undefined();
}

// discoverCharacteristics(deviceUuid, serviceUuid, characteristicUuids)
Napi::Value NobleMac::DiscoverCharacteristics(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG2(String, String)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    auto service = napiToUuidString(info[1].As<Napi::String>());
    NSArray* characteristics = getUuidArray(info[2]);
    [manager discoverCharacteristics:uuid forService:service characteristics:characteristics];
    return info.Env().Undefined();
}

// read(deviceUuid, serviceUuid, characteristicUuid)
Napi::Value NobleMac::Read(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG3(String, String, String)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    auto service = napiToUuidString(info[1].As<Napi::String>());
    auto characteristic = napiToUuidString(info[2].As<Napi::String>());
    [manager read:uuid service:service characteristic:characteristic];
    return info.Env().Undefined();
}

// write(deviceUuid, serviceUuid, characteristicUuid, data, withoutResponse)
Napi::Value NobleMac::Write(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG4(String, String, String, Buffer /*, Boolean */)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    auto service = napiToUuidString(info[1].As<Napi::String>());
    auto characteristic = napiToUuidString(info[2].As<Napi::String>());
    auto data = napiToData(info[3].As<Napi::Buffer<Byte>>());

    auto withoutResponse = false;
    if(info[4] && !(info[4].IsNull() || info[4].IsUndefined())) {
        withoutResponse = info[4].As<Napi::Boolean>().Value();
    }

    [manager write:uuid service:service characteristic:characteristic data:data withoutResponse:withoutResponse];
    return info.Env().Undefined();
}

// notify(deviceUuid, serviceUuid, characteristicUuid, notify)
Napi::Value NobleMac::Notify(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG4(String, String, String, Boolean)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    auto service = napiToUuidString(info[1].As<Napi::String>());
    auto characteristic = napiToUuidString(info[2].As<Napi::String>());
    auto on = info[3].As<Napi::Boolean>().Value();
    [manager notify:uuid service:service characteristic:characteristic on:on];
    return info.Env().Undefined();
}

// discoverDescriptors(deviceUuid, serviceUuid, characteristicUuid)
Napi::Value NobleMac::DiscoverDescriptors(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG3(String, String, String)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    auto service = napiToUuidString(info[1].As<Napi::String>());
    auto characteristic = napiToUuidString(info[2].As<Napi::String>());
    [manager discoverDescriptors:uuid service:service characteristic:characteristic];
    return info.Env().Undefined();
}

// readValue(deviceUuid, serviceUuid, characteristicUuid, descriptorUuid)
Napi::Value NobleMac::ReadValue(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG4(String, String, String, String)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    auto service = napiToUuidString(info[1].As<Napi::String>());
    auto characteristic = napiToUuidString(info[2].As<Napi::String>());
    auto descriptor = napiToUuidString(info[3].As<Napi::String>());
    [manager readValue:uuid service:service characteristic:characteristic descriptor:descriptor];
    return info.Env().Undefined();
}

// writeValue(deviceUuid, serviceUuid, characteristicUuid, descriptorUuid, data)
Napi::Value NobleMac::WriteValue(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG5(String, String, String, String, Buffer)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    auto service = napiToUuidString(info[1].As<Napi::String>());
    auto characteristic = napiToUuidString(info[2].As<Napi::String>());
    auto descriptor = napiToUuidString(info[3].As<Napi::String>());
    auto data = napiToData(info[4].As<Napi::Buffer<Byte>>());
    [manager writeValue:uuid service:service characteristic:characteristic descriptor:descriptor data: data];
    return info.Env().Undefined();
}

// readHandle(deviceUuid, handle)
Napi::Value NobleMac::ReadHandle(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG2(String, Number)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    auto handle = napiToNumber(info[1].As<Napi::Number>());
    [manager readHandle:uuid handle:handle];
    return info.Env().Undefined();
}

// writeHandle(deviceUuid, handle, data, (unused)withoutResponse)
Napi::Value NobleMac::WriteHandle(const Napi::CallbackInfo& info) 
{
    CHECK_MANAGER()
    ARG3(String, Number, Buffer)
    auto uuid = napiToUuidString(info[0].As<Napi::String>());
    auto handle = napiToNumber(info[1].As<Napi::Number>());
    auto data = napiToData(info[2].As<Napi::Buffer<Byte>>());
    [manager writeHandle:uuid handle:handle data: data];
    return info.Env().Undefined();
}

// addressToId(address)
Napi::Value NobleMac::AddressToId(const Napi::CallbackInfo& info) 
{
    ARG1(String)
    auto address = info[0].As<Napi::String>().Utf8Value();
    NSMutableString * uuidString = [[NSMutableString alloc] initWithCString:address.c_str() encoding:NSASCIIStringEncoding];
    if ([uuidString containsString:@"-"]) {
        NSUUID* uuid = [[NSUUID alloc] initWithUUIDString:uuidString];
        if (uuid) {
            NSString* canonical = uuid.UUIDString;
            NSString* result = [[canonical stringByReplacingOccurrencesOfString:@"-" withString:@""] lowercaseString];
            return Napi::String::New(info.Env(), [result UTF8String]);
        }
    }
    return info.Env().Null();
}

Napi::Object NobleMac::Init(Napi::Env env, Napi::Object exports) 
{
    Napi::HandleScope scope(env);

    Napi::Function func = DefineClass(env, "NobleMac", {
        NobleMac::InstanceMethod("start", &NobleMac::Start),
        NobleMac::InstanceMethod("stop", &NobleMac::Stop),
        NobleMac::InstanceMethod("startScanning", &NobleMac::Scan),
        NobleMac::InstanceMethod("stopScanning", &NobleMac::StopScan),
        NobleMac::InstanceMethod("connect", &NobleMac::Connect),
        NobleMac::InstanceMethod("disconnect", &NobleMac::Disconnect),
        NobleMac::InstanceMethod("cancelConnect", &NobleMac::CancelConnect),
        NobleMac::InstanceMethod("updateRssi", &NobleMac::UpdateRSSI),
        NobleMac::InstanceMethod("discoverServices", &NobleMac::DiscoverServices),
        NobleMac::InstanceMethod("discoverIncludedServices", &NobleMac::DiscoverIncludedServices),
        NobleMac::InstanceMethod("discoverCharacteristics", &NobleMac::DiscoverCharacteristics),
        NobleMac::InstanceMethod("read", &NobleMac::Read),
        NobleMac::InstanceMethod("write", &NobleMac::Write),
        NobleMac::InstanceMethod("notify", &NobleMac::Notify),
        NobleMac::InstanceMethod("discoverDescriptors", &NobleMac::DiscoverDescriptors),
        NobleMac::InstanceMethod("readValue", &NobleMac::ReadValue),
        NobleMac::InstanceMethod("writeValue", &NobleMac::WriteValue),
        NobleMac::InstanceMethod("readHandle", &NobleMac::ReadHandle),
        NobleMac::InstanceMethod("writeHandle", &NobleMac::WriteHandle),
        NobleMac::InstanceMethod("addressToId", &NobleMac::AddressToId),
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("NobleMac", func);
    return exports;
}

NODE_API_NAMED_ADDON(addon, NobleMac);
