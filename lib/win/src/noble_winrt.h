#pragma once

#include <napi.h>

#include <memory>

#include "JsBridge.h"
#include "ble_manager.h"

// noble's `Bindings` contract (src/bindings/bindings.ts), implemented natively:
// every request returns a promise settled through the JsBridge, and unsolicited
// activity is reported to the `BindingsDelegate` passed to start().

class NobleWinrt : public Napi::ObjectWrap<NobleWinrt>
{
public:
    NobleWinrt(const Napi::CallbackInfo&);
    Napi::Value Start(const Napi::CallbackInfo&);
    Napi::Value Stop(const Napi::CallbackInfo&);
    Napi::Value Scan(const Napi::CallbackInfo&);
    Napi::Value StopScan(const Napi::CallbackInfo&);
    Napi::Value Connect(const Napi::CallbackInfo&);
    Napi::Value Pair(const Napi::CallbackInfo&);
    Napi::Value IsPaired(const Napi::CallbackInfo&);
    Napi::Value Disconnect(const Napi::CallbackInfo&);
    Napi::Value CancelConnect(const Napi::CallbackInfo&);
    Napi::Value UpdateRSSI(const Napi::CallbackInfo&);
    Napi::Value DiscoverServices(const Napi::CallbackInfo&);
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
    Napi::Value AddressToId(const Napi::CallbackInfo& info);

    static Napi::Object Init(Napi::Env env, Napi::Object exports);

private:
    BLEManager* manager = nullptr;
    // The one channel back into JavaScript. Created by start(), closed by
    // stop(); the manager and its in-flight WinRT callbacks share it.
    std::shared_ptr<noble::JsBridge> bridge;
};
