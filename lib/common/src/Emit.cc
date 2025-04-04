#include "Emit.h"

#define _s(val) Napi::String::New(env, val)
#define _e(val) Napi::Error::New(env, _s(val)).Value()
#define _b(val) Napi::Boolean::New(env, val)
#define _n(val) Napi::Number::New(env, val)
#define _u(str) toUuid(env, str)

Napi::String toUuid(Napi::Env& env, const std::string& uuid)
{
    std::string str(uuid);
    str.erase(std::remove(str.begin(), str.end(), '-'), str.end());
    std::transform(str.begin(), str.end(), str.begin(), ::tolower);
    return _s(str);
}

Napi::String toAddressType(Napi::Env& env, const AddressType& type)
{
    if (type == PUBLIC)
    {
        return _s("public");
    }
    else if (type == RANDOM)
    {
        return _s("random");
    }
    return _s("unknown");
}

Napi::Buffer<uint8_t> toBuffer(Napi::Env& env, const Data& data)
{
    if (data.empty()) {
        return Napi::Buffer<uint8_t>::New(env, 0);
    }
    else {
        return Napi::Buffer<uint8_t>::Copy(env, &data[0], data.size());
    }
}

Napi::Array toUuidArray(Napi::Env& env, const std::vector<std::string>& data)
{
    if (data.empty())
    {
        return Napi::Array::New(env);
    }
    auto arr = Napi::Array::New(env, data.size());
    for (size_t i = 0; i < data.size(); i++)
    {
        arr.Set(i, _u(data[i]));
    }
    return arr;
}

Napi::Array toArray(Napi::Env& env, const std::vector<std::string>& data)
{
    if (data.empty())
    {
        return Napi::Array::New(env);
    }
    auto arr = Napi::Array::New(env, data.size());
    for (size_t i = 0; i < data.size(); i++)
    {
        arr.Set(i, _s(data[i]));
    }
    return arr;
}

void Emit::Wrap(const Napi::Value& receiver, const Napi::Function& callback)
{
    mCallback = std::make_shared<ThreadSafeCallback>(receiver, callback);
}

void Emit::RadioState(const std::string& state)
{
    mCallback->call([state](Napi::Env env, std::vector<napi_value>& args) {
        // emit('stateChange', state);
        args = { _s("stateChange"), _s(state) };
    });
}

void Emit::Address(const std::string& address)
{
    mCallback->call([address](Napi::Env env, std::vector<napi_value>& args) {
        // emit('addressChange', address);
        args = { _s("addressChange"), _s(address) };
    }); 
}

void Emit::ScanState(bool start)
{
    mCallback->call([start](Napi::Env env, std::vector<napi_value>& args) {
        // emit('scanStart') emit('scanStop')
        args = { _s(start ? "scanStart" : "scanStop") };
    });
}

void Emit::Scan(const std::string& uuid, int rssi, const Peripheral& peripheral)
{
    // Copy values to capture in lambda
    auto address = peripheral.address;
    auto addressType = peripheral.addressType;
    auto connectable = peripheral.connectable;
    auto name = peripheral.name;
    auto txPowerLevel = peripheral.txPowerLevel;
    auto manufacturerData = peripheral.manufacturerData;
    auto serviceData = peripheral.serviceData;
    auto serviceUuids = peripheral.serviceUuids;

    mCallback->call([uuid, rssi, address, addressType, connectable, name, txPowerLevel,
                     manufacturerData, serviceData,
                     serviceUuids](Napi::Env env, std::vector<napi_value>& args) {
        Napi::Object advertisment = Napi::Object::New(env);
        
        // Handle optional name
        advertisment.Set(_s("localName"), 
            name.has_value() ? _s(name.value()) : env.Null());
        
        // Handle optional txPowerLevel
        advertisment.Set(_s("txPowerLevel"), 
            txPowerLevel.has_value() ? _n(txPowerLevel.value()) : env.Null());
        
        // Handle optional manufacturerData
        advertisment.Set(_s("manufacturerData"), 
            manufacturerData.has_value() ? toBuffer(env, manufacturerData.value()) : Napi::Buffer<uint8_t>::New(env, 0));

        // Handle optional serviceData
        auto array = Napi::Array::New(env);
        if (serviceData.has_value()) {
            const auto& data = serviceData.value();
            array = Napi::Array::New(env, data.size());
            for (size_t i = 0; i < data.size(); i++) {
                Napi::Object dataObj = Napi::Object::New(env);
                dataObj.Set(_s("uuid"), _u(data[i].first));
                dataObj.Set(_s("data"), toBuffer(env, data[i].second));
                array.Set(i, dataObj);
            }
        }
        advertisment.Set(_s("serviceData"), array);

        // Handle optional serviceUuids
        advertisment.Set(_s("serviceUuids"), serviceUuids.has_value() ? toUuidArray(env, serviceUuids.value()) : Napi::Array::New(env));
        
        // emit('discover', deviceUuid, address, addressType, connectable, advertisement, rssi);
        args = { _s("discover"),  _u(uuid),     _s(address), toAddressType(env, addressType),
                 _b(connectable), advertisment, _n(rssi) };
    });
}

void Emit::Connected(const std::string& uuid, const std::string& error)
{
    mCallback->call([uuid, error](Napi::Env env, std::vector<napi_value>& args) {
        // emit('connect', deviceUuid) error added here
        args = { _s("connect"), _u(uuid), error.empty() ? env.Null() : _e(error) };
    });
}

void Emit::Disconnected(const std::string& uuid)
{
    mCallback->call([uuid](Napi::Env env, std::vector<napi_value>& args) {
        // emit('disconnect', deviceUuid);
        args = { _s("disconnect"), _u(uuid) };
    });
}

void Emit::RSSI(const std::string& uuid, int rssi)
{
    mCallback->call([uuid, rssi](Napi::Env env, std::vector<napi_value>& args) {
        // emit('rssiUpdate', deviceUuid, rssi);
        args = { _s("rssiUpdate"), _u(uuid), _n(rssi) };
    });
}

void Emit::ServicesDiscovered(const std::string& uuid, const std::vector<std::string>& serviceUuids, const std::string& error)
{
    mCallback->call([uuid, serviceUuids, error](Napi::Env env, std::vector<napi_value>& args) {
        // emit('servicesDiscover', deviceUuid, serviceUuids)
        args = { _s("servicesDiscover"), _u(uuid), toUuidArray(env, serviceUuids), error.empty() ? env.Null() : _e(error) };
    });
}

void Emit::IncludedServicesDiscovered(const std::string& uuid, const std::string& serviceUuid,
                                      const std::vector<std::string>& serviceUuids, const std::string& error)
{
    mCallback->call(
        [uuid, serviceUuid, serviceUuids, error](Napi::Env env, std::vector<napi_value>& args) {
            // emit('includedServicesDiscover', deviceUuid, serviceUuid, includedServiceUuids)
            args = { _s("includedServicesDiscover"), _u(uuid), _u(serviceUuid),
                     toUuidArray(env, serviceUuids), error.empty() ? env.Null() : _e(error) };
        });
}

void Emit::CharacteristicsDiscovered(
    const std::string& uuid, const std::string& serviceUuid,
    const std::vector<std::pair<std::string, std::vector<std::string>>>& characteristics, const std::string& error)
{
    mCallback->call(
        [uuid, serviceUuid, characteristics, error](Napi::Env env, std::vector<napi_value>& args) {
            auto arr = characteristics.empty() ? Napi::Array::New(env)
                                               : Napi::Array::New(env, characteristics.size());
            for (size_t i = 0; i < characteristics.size(); i++)
            {
                Napi::Object characteristic = Napi::Object::New(env);
                characteristic.Set(_s("uuid"), _u(characteristics[i].first));
                characteristic.Set(_s("properties"), toArray(env, characteristics[i].second));
                arr.Set(i, characteristic);
            }
            // emit('characteristicsDiscover', deviceUuid, serviceUuid, { uuid, properties:
            // ['broadcast', 'read', ...]})
            args = { _s("characteristicsDiscover"), _u(uuid), _u(serviceUuid), arr, error.empty() ? env.Null() : _e(error) };
        });
}

void Emit::Read(const std::string& uuid, const std::string& serviceUuid,
                const std::string& characteristicUuid, const Data& data, bool isNotification, const std::string& error)
{
    mCallback->call([uuid, serviceUuid, characteristicUuid, data,
                     isNotification, error](Napi::Env env, std::vector<napi_value>& args) {
        // emit('read', deviceUuid, serviceUuid, characteristicsUuid, data, isNotification);
        args = { 
            _s("read"), 
            _u(uuid), 
            _u(serviceUuid), 
            _u(characteristicUuid), 
            error.empty() ? toBuffer(env, data) : env.Null(), 
            _b(isNotification), 
            error.empty() ? env.Null() : _e(error) 
        };
    });
}

void Emit::Write(const std::string& uuid, const std::string& serviceUuid,
                 const std::string& characteristicUuid, const std::string& error)
{
    mCallback->call(
        [uuid, serviceUuid, characteristicUuid, error](Napi::Env env, std::vector<napi_value>& args) {
            // emit('write', deviceUuid, servicesUuid, characteristicsUuid)
            args = { _s("write"), _u(uuid), _u(serviceUuid), _u(characteristicUuid), error.empty() ? env.Null() : _e(error) };
        });
}

void Emit::Notify(const std::string& uuid, const std::string& serviceUuid,
                  const std::string& characteristicUuid, bool state, const std::string& error)
{
    mCallback->call([uuid, serviceUuid, characteristicUuid, state, error](Napi::Env env,
                                                                   std::vector<napi_value>& args) {
        // emit('notify', deviceUuid, servicesUuid, characteristicsUuid, state)
        args = { _s("notify"), _u(uuid), _u(serviceUuid), _u(characteristicUuid), _b(state), error.empty() ? env.Null() : _e(error) };
    });
}

void Emit::DescriptorsDiscovered(const std::string& uuid, const std::string& serviceUuid,
                                 const std::string& characteristicUuid,
                                 const std::vector<std::string>& descriptorUuids, const std::string& error)
{
    mCallback->call([uuid, serviceUuid, characteristicUuid, descriptorUuids, error](Napi::Env env, std::vector<napi_value>& args) {
        // emit('descriptorsDiscover', deviceUuid, servicesUuid, characteristicsUuid, descriptors:[uuids])
        args = { 
            _s("descriptorsDiscover"), 
            _u(uuid), 
            _u(serviceUuid), 
            _u(characteristicUuid), 
            toUuidArray(env, descriptorUuids), 
            error.empty() ? env.Null() : _e(error) 
        };
    });
}

void Emit::ReadValue(const std::string& uuid, const std::string& serviceUuid,
                     const std::string& characteristicUuid, const std::string& descriptorUuid,
                     const Data& data, const std::string& error)
{
    mCallback->call([uuid, serviceUuid, characteristicUuid, descriptorUuid,
                     data, error](Napi::Env env, std::vector<napi_value>& args) {
        // emit('valueRead', deviceUuid, serviceUuid, characteristicUuid, descriptorUuid, data)
        args = { 
            _s("valueRead"), 
            _u(uuid), 
            _u(serviceUuid), 
            _u(characteristicUuid), 
            _u(descriptorUuid), 
            error.empty() ? toBuffer(env, data) : env.Null(), 
            error.empty() ? env.Null() : _e(error) 
        };
    });
}

void Emit::WriteValue(const std::string& uuid, const std::string& serviceUuid,
                      const std::string& characteristicUuid, const std::string& descriptorUuid, const std::string& error)
{
    mCallback->call([uuid, serviceUuid, characteristicUuid, descriptorUuid, error](Napi::Env env, std::vector<napi_value>& args) {
        // emit('valueWrite', deviceUuid, serviceUuid, characteristicUuid, descriptorUuid);
        args = { _s("valueWrite"), _u(uuid), _u(serviceUuid), _u(characteristicUuid),
                 _u(descriptorUuid), error.empty() ? env.Null() : _e(error) };
    });
}

void Emit::ReadHandle(const std::string& uuid, int descriptorHandle, const Data& data, const std::string& error)
{
    mCallback->call([uuid, descriptorHandle, data, error](Napi::Env env, std::vector<napi_value>& args) {
        // emit('handleRead', deviceUuid, descriptorHandle, data);
        args = { 
            _s("handleRead"), 
            _u(uuid), 
            _n(descriptorHandle), 
            error.empty() ? toBuffer(env, data) : env.Null(), 
            error.empty() ? env.Null() : _e(error) 
        };
    });
}

void Emit::WriteHandle(const std::string& uuid, int descriptorHandle, const std::string& error)
{
    mCallback->call([uuid, descriptorHandle, error](Napi::Env env, std::vector<napi_value>& args) {
        // emit('handleWrite', deviceUuid, descriptorHandle);
        args = { _s("handleWrite"), _u(uuid), _n(descriptorHandle), error.empty() ? env.Null() : _e(error) };
    });
}
