#include "napi_winrt.h"

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
        int id = std::stoi(str, 0, 16);
        return BluetoothUuidHelper::FromShortId(id);
    }
    UUID uuid;
    UuidFromString((RPC_CSTR)str.c_str(), &uuid);
    std::array<uint8_t, 8> data4;
    std::copy_n(uuid.Data4, data4.size(), data4.begin());
    return winrt::guid(uuid.Data1, uuid.Data2, uuid.Data3, data4);
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
    if (value.IsNumber())
    {
        double asDouble = value.As<Napi::Number>().DoubleValue();
        // Reject fractional values to surface caller-side bugs (e.g. a float
        // that crept in from arithmetic) instead of silently truncating with
        // Uint32Value(). `DoubleValue() == asDouble` is exact for values in
        // the int32 range, so the int32 fast path is unaffected.
        if (asDouble != static_cast<double>(static_cast<int64_t>(asDouble)))
        {
            return def;
        }
        return static_cast<uint32_t>(asDouble);
    }
    return def;
}
