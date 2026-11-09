#include "napi_winrt.h"

#include <algorithm>
#include <array>
#include <cctype>

#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>
#include <rpc.h>

using namespace winrt::Windows::Devices::Bluetooth;

winrt::guid napiToUuid(Napi::String string)
{
    std::string str = string.Utf8Value();
    if (str.size() == 32)
    {
        str.insert(8, "-");
        str.insert(13, "-");
        str.insert(18, "-");
        str.insert(23, "-");
    }
    if (str.size() == 4 || str.size() == 8)
    {
        // std::stoul throws on garbage; an exception that is not a Napi::Error
        // must never escape into N-API, so validate first.
        if (str.find_first_not_of("0123456789ABCDEFabcdef") != std::string::npos)
        {
            throw Napi::TypeError::New(string.Env(), "Invalid UUID: " + str);
        }
        uint32_t id = static_cast<uint32_t>(std::stoul(str, 0, 16));
        return BluetoothUuidHelper::FromShortId(id);
    }
    UUID uuid;
    if (UuidFromStringA((RPC_CSTR)str.c_str(), &uuid) != RPC_S_OK)
    {
        throw Napi::TypeError::New(string.Env(), "Invalid UUID: " + str);
    }
    std::array<uint8_t, 8> data4;
    std::copy_n(uuid.Data4, data4.size(), data4.begin());
    return winrt::guid(uuid.Data1, uuid.Data2, uuid.Data3, data4);
}

std::string napiToPeripheralId(Napi::String string)
{
    std::string id = string.Utf8Value();
    id.erase(std::remove_if(id.begin(), id.end(), [](char c) { return c == ':' || c == '-'; }),
             id.end());
    std::transform(id.begin(), id.end(), id.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return id;
}

std::vector<winrt::guid> napiToUuidArray(Napi::Array array)
{
    std::vector<winrt::guid> uuids;
    for (size_t i = 0; i < array.Length(); i++)
    {
        Napi::Value val = array[i];
        uuids.push_back(napiToUuid(val.As<Napi::String>()));
    }
    return uuids;
}

Data napiToData(Napi::Buffer<byte> buffer)
{
    Data data;
    auto bytes = buffer.Data();
    data.assign(bytes, bytes + buffer.Length());
    return data;
}

int napiToNumber(Napi::Number number)
{
    return number.Int32Value();
}

std::vector<winrt::guid> getUuidArray(const Napi::Value& value)
{
    if (value.IsArray())
    {
        return napiToUuidArray(value.As<Napi::Array>());
    }
    return std::vector<winrt::guid>();
}

bool getBool(const Napi::Value& value, bool def)
{
    if (value.IsBoolean())
    {
        return value.As<Napi::Boolean>().Value();
    }
    return def;
}

uint32_t getUint32(const Napi::Value& value, uint32_t def)
{
    if (!value.IsNumber())
    {
        return def;
    }
    
    const double asDouble = value.As<Napi::Number>().DoubleValue();
    // Reject NaN / infinities / negatives / values outside uint32 range.
    // (NaN makes both comparisons false, so it is rejected here.)
    if (!(asDouble >= 0.0 && asDouble <= 4294967295.0))
    {
        return def;
    }
    const uint32_t asUint32 = static_cast<uint32_t>(asDouble);
    // Reject fractional values (and values not exactly representable as uint32).
    if (asDouble != static_cast<double>(asUint32))
    {
        return def;
    }
    return asUint32;
}

Napi::String toUuid(Napi::Env env, const std::string& uuid)
{
    std::string str(uuid);
    str.erase(std::remove(str.begin(), str.end(), '-'), str.end());
    std::transform(str.begin(), str.end(), str.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return Napi::String::New(env, str);
}

Napi::String toAddressType(Napi::Env env, AddressType type)
{
    if (type == PUBLIC)
    {
        return Napi::String::New(env, "public");
    }
    else if (type == RANDOM)
    {
        return Napi::String::New(env, "random");
    }
    return Napi::String::New(env, "unknown");
}

Napi::Value toBuffer(Napi::Env env, const Data& data)
{
    if (data.empty())
    {
        return Napi::Buffer<uint8_t>::New(env, 0);
    }
    return Napi::Buffer<uint8_t>::Copy(env, data.data(), data.size());
}

Napi::Array toUuidArray(Napi::Env env, const std::vector<std::string>& data)
{
    auto arr = Napi::Array::New(env, data.size());
    for (size_t i = 0; i < data.size(); i++)
    {
        arr.Set(static_cast<uint32_t>(i), toUuid(env, data[i]));
    }
    return arr;
}

Napi::Array toStringArray(Napi::Env env, const std::vector<std::string>& data)
{
    auto arr = Napi::Array::New(env, data.size());
    for (size_t i = 0; i < data.size(); i++)
    {
        arr.Set(static_cast<uint32_t>(i), Napi::String::New(env, data[i]));
    }
    return arr;
}

Napi::Array toCharacteristicArray(
    Napi::Env env,
    const std::vector<std::pair<std::string, std::vector<std::string>>>& characteristics)
{
    auto arr = Napi::Array::New(env, characteristics.size());
    for (size_t i = 0; i < characteristics.size(); i++)
    {
        Napi::Object characteristic = Napi::Object::New(env);
        characteristic.Set("uuid", toUuid(env, characteristics[i].first));
        characteristic.Set("properties", toStringArray(env, characteristics[i].second));
        arr.Set(static_cast<uint32_t>(i), characteristic);
    }
    return arr;
}

Napi::Object toDiscoveredPeripheral(Napi::Env env, const std::string& id, int rssi,
                                    const Peripheral& peripheral)
{
    Napi::Object advertisement = Napi::Object::New(env);

    // Absent optional fields are reported as null.
    if (peripheral.name.has_value())
    {
        advertisement.Set("localName", Napi::String::New(env, peripheral.name.value()));
    }
    else
    {
        advertisement.Set("localName", env.Null());
    }

    if (peripheral.txPowerLevel.has_value())
    {
        advertisement.Set("txPowerLevel", Napi::Number::New(env, peripheral.txPowerLevel.value()));
    }
    else
    {
        advertisement.Set("txPowerLevel", env.Null());
    }

    if (peripheral.manufacturerData.has_value())
    {
        advertisement.Set("manufacturerData", toBuffer(env, peripheral.manufacturerData.value()));
    }
    else
    {
        advertisement.Set("manufacturerData", env.Null());
    }

    auto serviceData = Napi::Array::New(env);
    if (peripheral.serviceData.has_value())
    {
        const auto& data = peripheral.serviceData.value();
        for (size_t i = 0; i < data.size(); i++)
        {
            Napi::Object entry = Napi::Object::New(env);
            entry.Set("uuid", toUuid(env, data[i].first));
            entry.Set("data", toBuffer(env, data[i].second));
            serviceData.Set(static_cast<uint32_t>(i), entry);
        }
    }
    advertisement.Set("serviceData", serviceData);

    if (peripheral.serviceUuids.has_value())
    {
        advertisement.Set("serviceUuids", toUuidArray(env, peripheral.serviceUuids.value()));
    }
    else
    {
        advertisement.Set("serviceUuids", Napi::Array::New(env));
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("id", toUuid(env, id));
    result.Set("address", Napi::String::New(env, peripheral.address));
    result.Set("addressType", toAddressType(env, peripheral.addressType));
    result.Set("connectable", Napi::Boolean::New(env, peripheral.connectable));
    result.Set("advertisement", advertisement);
    result.Set("rssi", Napi::Number::New(env, rssi));
    return result;
}
