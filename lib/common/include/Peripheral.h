#pragma once

#include <vector>
#include <string>
#include <optional>

using Data = std::vector<uint8_t>;

enum AddressType {
    PUBLIC,
    RANDOM,
    UNKNOWN,
};

class Peripheral {
public:
    Peripheral(): 
        address("unknown"), 
        addressType(UNKNOWN), 
        connectable(false) {}

    std::string address;
    AddressType addressType;
    bool connectable;
    
    std::optional<std::string> name;
    std::optional<int> txPowerLevel;
    std::optional<Data> manufacturerData;
    std::optional<std::vector<std::pair<std::string, Data>>> serviceData;
    std::optional<std::vector<std::string>> serviceUuids;
};
