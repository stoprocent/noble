#pragma once

#include <napi.h>
#include "winrt/base.h"
#include "Peripheral.h"

std::vector<winrt::guid> getUuidArray(const Napi::Value& value);
bool getBool(const Napi::Value& value, bool def);

winrt::guid napiToUuid(Napi::String string);
Data napiToData(Napi::Buffer<unsigned char> buffer);
int napiToNumber(Napi::Number number);
