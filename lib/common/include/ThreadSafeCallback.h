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
    // Use NonBlockingCall to avoid hanging if environment is destroyed
    // This will queue the callback but not block waiting for it
    if (threadSafeFunction_.NonBlockingCall(argFn) != napi_ok) {
        delete argFn;
    }
}

inline void ThreadSafeCallback::callJsCallback(
    Napi::Env env,
    Napi::Function jsCallback,
    Napi::Reference<Napi::Value>* context,
    ArgumentFunction* argFn) {
    
    if (argFn == nullptr) {
        return;
    }

    // Check if environment and callback are valid before proceeding
    if (env == nullptr || jsCallback == nullptr || context == nullptr) {
        delete argFn;
        return;
    }

    // Check if context reference is still valid
    if (context->IsEmpty()) {
        delete argFn;
        return;
    }
    
    try {
        ArgumentVector args;
        (*argFn)(env, args);
        delete argFn;

        // Get the receiver value and check if it's valid
        Napi::Value receiverValue = context->Value();
        // Check if receiver value is null or undefined (invalid)
        if (receiverValue.IsNull() || receiverValue.IsUndefined()) {
            return;
        }

        // Attempt to call the callback with error handling
        // If the environment is being destroyed, this may fail
        // Note: N-API errors don't throw C++ exceptions, so this won't catch
        // napi_open_callback_scope failures, but it helps with other cases
        try {
            jsCallback.Call(receiverValue, args);
        } catch (const std::exception&) {
            // Silently ignore exceptions - environment might be destroyed
        } catch (...) {
            // Catch any other exceptions during callback execution
        }
    } catch (const std::exception&) {
        // If argument building fails, just clean up
        delete argFn;
    } catch (...) {
        // Catch any other exceptions and clean up
        delete argFn;
    }
}