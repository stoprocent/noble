#pragma once

#include <napi.h>

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace noble
{

using RequestId = uint64_t;

/**
 * The one channel from native code back into JavaScript.
 *
 * The addons implement noble's `Bindings` contract directly:
 *
 *  - a request (connect, read, ...) returns a promise. The JS-facing method
 *    calls `createRequest()` and hands the returned id to the platform code,
 *    which later calls `resolve()` / `reject()` with it from any thread;
 *  - unsolicited activity (state changes, discoveries, disconnects,
 *    notifications) is reported with `notify()`, which calls the matching
 *    method of the `BindingsDelegate` object that was passed to `start()`.
 *
 * Everything that touches JavaScript runs on the JS thread through a single
 * thread-safe function. While a bridge is open that function keeps the event
 * loop alive; `close()` releases it, so a stopped addon lets the process exit.
 *
 * Platform code holds the bridge through a `std::shared_ptr` and may keep
 * calling `resolve` / `reject` / `notify` after `close()` (late completions
 * from the OS are unavoidable): those calls are then silently dropped.
 */
class JsBridge
{
public:
    /// Builds the value a promise resolves with. Runs on the JS thread.
    using ValueFactory = std::function<Napi::Value(Napi::Env)>;
    /// Builds the arguments of a delegate call. Runs on the JS thread.
    using ArgsFactory = std::function<std::vector<napi_value>(Napi::Env)>;

    /// JS thread only. `delegate` is the object passed to `start()`.
    static std::shared_ptr<JsBridge> Create(Napi::Env env, Napi::Object delegate)
    {
        return std::shared_ptr<JsBridge>(new JsBridge(env, delegate));
    }

    ~JsBridge()
    {
        std::lock_guard<std::mutex> lock(mMutex);
        if (!mReleased)
        {
            mReleased = true;
            mFunction.Abort();
        }
    }

    JsBridge(const JsBridge&) = delete;
    JsBridge& operator=(const JsBridge&) = delete;

    /// JS thread only. Returns the id to settle later and the promise to hand to JavaScript.
    std::pair<RequestId, Napi::Promise> createRequest(Napi::Env env)
    {
        auto deferred = Napi::Promise::Deferred::New(env);
        auto promise = deferred.Promise();
        if (mState->closed)
        {
            deferred.Reject(Napi::Error::New(env, "noble is stopped").Value());
            return { 0, promise };
        }
        RequestId id = ++mState->lastRequestId;
        mState->pending.emplace(id, deferred);
        return { id, promise };
    }

    /// JS thread only. A promise that is already rejected, for requests that cannot even start.
    static Napi::Promise Rejected(Napi::Env env, const std::string& message)
    {
        auto deferred = Napi::Promise::Deferred::New(env);
        deferred.Reject(Napi::Error::New(env, message).Value());
        return deferred.Promise();
    }

    /// Any thread. Resolves with `undefined` when no factory is given.
    void resolve(RequestId id, ValueFactory value = nullptr)
    {
        run([id, value = std::move(value)](Napi::Env env, State& state) {
            auto it = state.pending.find(id);
            if (it == state.pending.end())
            {
                return;
            }
            auto deferred = it->second;
            state.pending.erase(it);
            deferred.Resolve(value ? value(env) : env.Undefined());
        });
    }

    /// Any thread.
    void reject(RequestId id, std::string message)
    {
        run([id, message = std::move(message)](Napi::Env env, State& state) {
            auto it = state.pending.find(id);
            if (it == state.pending.end())
            {
                return;
            }
            auto deferred = it->second;
            state.pending.erase(it);
            deferred.Reject(Napi::Error::New(env, message).Value());
        });
    }

    /// Any thread. Calls `delegate[method](...args)`.
    void notify(std::string method, ArgsFactory args = nullptr)
    {
        run([method = std::move(method), args = std::move(args)](Napi::Env env, State& state) {
            Napi::HandleScope scope(env);
            Napi::Object delegate = state.delegate.Value();
            Napi::Value function = delegate.Get(method);
            if (!function.IsFunction())
            {
                return;
            }
            std::vector<napi_value> arguments = args ? args(env) : std::vector<napi_value>();
            try
            {
                function.As<Napi::Function>().Call(delegate, arguments);
            }
            catch (const Napi::Error& error)
            {
                // A listener threw: surface it exactly like any other uncaught exception.
                napi_fatal_exception(env, error.Value());
            }
        });
    }

    /**
     * JS thread only. Rejects everything still pending, drops the delegate and
     * stops keeping the event loop alive. Idempotent.
     */
    void close(Napi::Env env, const std::string& reason = "noble was stopped")
    {
        if (mState->closed)
        {
            return;
        }
        mState->closed = true;

        auto pending = std::move(mState->pending);
        mState->pending.clear();
        for (auto& entry : pending)
        {
            entry.second.Reject(Napi::Error::New(env, reason).Value());
        }
        mState->delegate.Reset();

        std::lock_guard<std::mutex> lock(mMutex);
        if (!mReleased)
        {
            mReleased = true;
            mFunction.Release();
        }
    }

private:
    /// Only ever touched on the JS thread.
    struct State
    {
        bool closed = false;
        RequestId lastRequestId = 0;
        std::unordered_map<RequestId, Napi::Promise::Deferred> pending;
        Napi::ObjectReference delegate;
    };

    using Task = std::function<void(Napi::Env, State&)>;

    struct Call
    {
        // Tasks outlive the bridge when the OS completes something late.
        std::shared_ptr<State> state;
        Task task;
    };

    JsBridge(Napi::Env env, Napi::Object delegate) : mState(std::make_shared<State>())
    {
        mState->delegate = Napi::Persistent(delegate);
        mFunction = Napi::ThreadSafeFunction::New(
            env, Napi::Function::New(env, [](const Napi::CallbackInfo&) {}), "noble", 0, 1);
    }

    void run(Task task)
    {
        auto call = new Call{ mState, std::move(task) };

        std::lock_guard<std::mutex> lock(mMutex);
        if (mReleased ||
            mFunction.NonBlockingCall(call, &JsBridge::Invoke) != napi_ok)
        {
            delete call;
        }
    }

    static void Invoke(Napi::Env env, Napi::Function, Call* call)
    {
        std::unique_ptr<Call> owned(call);
        // `env` is null while the environment is being torn down.
        if (env == nullptr || owned->state->closed)
        {
            return;
        }
        Napi::HandleScope scope(env);
        try
        {
            owned->task(env, *owned->state);
        }
        catch (const Napi::Error& error)
        {
            napi_fatal_exception(env, error.Value());
        }
        catch (...)
        {
        }
    }

    std::shared_ptr<State> mState;
    std::mutex mMutex;
    bool mReleased = false;
    Napi::ThreadSafeFunction mFunction;
};

} // namespace noble
