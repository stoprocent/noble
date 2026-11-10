#pragma once

#include <napi.h>
#include <string>
#include <utility>
#include <vector>
#include "winrt/base.h"
#include "Peripheral.h"

// --- JavaScript -> native ----------------------------------------------------

std::vector<winrt::guid> getUuidArray(const Napi::Value& value);
bool getBool(const Napi::Value& value, bool def);
uint32_t getUint32(const Napi::Value& value, uint32_t def);

// Throws a JavaScript TypeError when the string is not a UUID.
winrt::guid napiToUuid(Napi::String string);
// Peripheral ids are lowercase hex without separators; accept a MAC address too.
std::string napiToPeripheralId(Napi::String string);
Data napiToData(Napi::Buffer<unsigned char> buffer);
int napiToNumber(Napi::Number number);

// --- native -> JavaScript ----------------------------------------------------
// JS thread only: these run inside the JsBridge value / argument factories.

// UUIDs and peripheral ids are reported as lowercase hex without dashes.
Napi::String toUuid(Napi::Env env, const std::string& uuid);
Napi::String toAddressType(Napi::Env env, AddressType type);
Napi::Value toBuffer(Napi::Env env, const Data& data);
Napi::Array toUuidArray(Napi::Env env, const std::vector<std::string>& data);
Napi::Array toStringArray(Napi::Env env, const std::vector<std::string>& data);
// [{ uuid, properties: ['read', ...] }]
Napi::Array toCharacteristicArray(
    Napi::Env env,
    const std::vector<std::pair<std::string, std::vector<std::string>>>& characteristics);
// { id, address, addressType, connectable, advertisement: { ... }, rssi }
Napi::Object toDiscoveredPeripheral(Napi::Env env, const std::string& id, int rssi,
                                    const Peripheral& peripheral);
