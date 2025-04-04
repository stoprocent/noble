#pragma once

#include <napi.h>
#include <vector>
#include <functional>

class ThreadSafeCallback {
public:
    // More descriptive type aliases
    using ArgumentVector = std::vector<napi_value>;
    using ArgumentFunction = std::function<void(napi_env, ArgumentVector&)>;

    // Constructor with validation
    ThreadSafeCallback(const Napi::Value& receiver, const Napi::Function& jsCallback);
    
    // Destructor
    ~ThreadSafeCallback();

    // Delete copy and move operations explicitly
    ThreadSafeCallback(const ThreadSafeCallback&) = delete;
    ThreadSafeCallback& operator=(const ThreadSafeCallback&) = delete;
    ThreadSafeCallback& operator=(ThreadSafeCallback&&) = delete;

    // Public interface
    void call(ArgumentFunction argFunction);

private:
    // Static callback handler
    static void callJsCallback(Napi::Env env,
                             Napi::Function jsCallback,
                             Napi::Reference<Napi::Value>* context,
                             ArgumentFunction* argFn);

    // Type alias for the thread-safe function
    using ThreadSafeFunc = Napi::TypedThreadSafeFunction<
        Napi::Reference<Napi::Value>,
        ArgumentFunction,
        callJsCallback>;

    // Member variables
    Napi::Reference<Napi::Value> receiver_;
    ThreadSafeFunc threadSafeFunction_;
};

// Implementation

inline ThreadSafeCallback::ThreadSafeCallback(
    const Napi::Value& receiver,
    const Napi::Function& jsCallback) {
    
    if (!(receiver.IsObject() || receiver.IsFunction())) {
        throw Napi::Error::New(jsCallback.Env(),
            "Callback receiver must be an object or function");
    }
    if (!jsCallback.IsFunction()) {
        throw Napi::Error::New(jsCallback.Env(),
            "Callback must be a function");
    }

    receiver_ = Napi::Persistent(receiver);
    threadSafeFunction_ = ThreadSafeFunc::New(
        jsCallback.Env(),
        jsCallback,
        "ThreadSafeCallback callback",
        0, 1,
        &receiver_);
}

inline ThreadSafeCallback::~ThreadSafeCallback() {
    threadSafeFunction_.Abort();
}

inline void ThreadSafeCallback::call(ArgumentFunction argFunction) {
    auto argFn = new ArgumentFunction(argFunction);
    if (threadSafeFunction_.BlockingCall(argFn) != napi_ok) {
        delete argFn;
    }
}

inline void ThreadSafeCallback::callJsCallback(
    Napi::Env env,
    Napi::Function jsCallback,
    Napi::Reference<Napi::Value>* context,
    ArgumentFunction* argFn) {
    
    if (argFn != nullptr) {
        ArgumentVector args;
        (*argFn)(env, args);
        delete argFn;

        if (env != nullptr && jsCallback != nullptr) {
            jsCallback.Call(context->Value(), args);
        }
    }
}