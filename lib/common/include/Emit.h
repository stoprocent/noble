#pragma once

#include <napi.h>
#include <vector>
#include <string>

#include "Peripheral.h"
#include "ThreadSafeCallback.h"

class Emit
{
public:
    // clang-format off
    void Wrap(const Napi::Value& receiver, const Napi::Function& callback);
    void RadioState(const std::string& status);
    void Address(const std::string& address);
    void ScanState(bool start);
    void Scan(const std::string& uuid, int rssi, const Peripheral& peripheral);
    void Connected(const std::string& uuid, const std::string& error = "");
    void Disconnected(const std::string& uuid);
    void RSSI(const std::string& uuid, int rssi);
    void ServicesDiscovered(const std::string& uuid, const std::vector<std::string>& serviceUuids, const std::string& error = "");
    void IncludedServicesDiscovered(const std::string& uuid, const std::string& serviceUuid, const std::vector<std::string>& serviceUuids, const std::string& error = "");
    void CharacteristicsDiscovered(const std::string& uuid, const std::string& serviceUuid, const std::vector<std::pair<std::string, std::vector<std::string>>>& characteristics, const std::string& error = "");
    void Read(const std::string& uuid, const std::string& serviceUuid, const std::string& characteristicUuid, const Data& data, bool isNotification, const std::string& error = "");
    void Write(const std::string& uuid, const std::string& serviceUuid, const std::string& characteristicUuid, const std::string& error = "");
    void Notify(const std::string& uuid, const std::string& serviceUuid, const std::string& characteristicUuid, bool state, const std::string& error = "");
    void DescriptorsDiscovered(const std::string& uuid, const std::string& serviceUuid, const std::string& characteristicUuid, const std::vector<std::string>& descriptorUuids, const std::string& error = "");
    void ReadValue(const std::string& uuid, const std::string& serviceUuid, const std::string& characteristicUuid, const std::string& descriptorUuid, const Data& data, const std::string& error = "");
    void WriteValue(const std::string& uuid, const std::string& serviceUuid, const std::string& characteristicUuid, const std::string& descriptorUuid, const std::string& error = "");
    void ReadHandle(const std::string& uuid, int descriptorHandle, const Data& data, const std::string& error = "");
    void WriteHandle(const std::string& uuid, int descriptorHandle, const std::string& error = "");
    // clang-format on
protected:
    std::shared_ptr<ThreadSafeCallback> mCallback;
};
