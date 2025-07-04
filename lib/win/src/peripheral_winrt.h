#pragma once

#include <napi.h>
#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <winrt/Windows.Devices.Bluetooth.Advertisement.h>
#include <winrt/Windows.Devices.Bluetooth.GenericAttributeProfile.h>

using namespace winrt::Windows::Devices::Bluetooth::Advertisement;
using winrt::Windows::Devices::Bluetooth::BluetoothLEDevice;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattCharacteristic;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattDescriptor;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattDeviceService;
using winrt::Windows::Devices::Bluetooth::GenericAttributeProfile::GattSession;

#include "winrt/Windows.Devices.Bluetooth.h"

#include <string>
#include <optional>

#include "Peripheral.h"
#include "winrt_guid.h"

class CachedCharacteristic
{
public:
    CachedCharacteristic() = default;
    CachedCharacteristic(GattCharacteristic& c) : characteristic(c)
    {
    }

    GattCharacteristic characteristic = nullptr;
    std::unordered_map<winrt::guid, GattDescriptor> descriptors;
};

class CachedService
{
public:
    CachedService() = default;
    CachedService(GattDeviceService& s) : service(s)
    {
    }

    GattDeviceService service = nullptr;
    std::unordered_map<winrt::guid, CachedCharacteristic> characterisitics;
};

class PeripheralWinrt : public Peripheral
{
public:
    PeripheralWinrt() = default;
    PeripheralWinrt(uint64_t bluetoothAddress, BluetoothLEAdvertisementType advertismentType,
                    int rssiValue, const BluetoothLEAdvertisement& advertisment);
    ~PeripheralWinrt();

    void Update(int rssiValue, const BluetoothLEAdvertisement& advertisment,
                const BluetoothLEAdvertisementType& advertismentType);

    void Disconnect();

    void GetService(winrt::guid serviceUuid,
                    std::function<void(std::optional<GattDeviceService>)> callback);
    void GetCharacteristic(winrt::guid serviceUuid, winrt::guid characteristicUuid,
                           std::function<void(std::optional<GattCharacteristic>)> callback);
    void GetDescriptor(winrt::guid serviceUuid, winrt::guid characteristicUuid,
                       winrt::guid descriptorUuid,
                       std::function<void(std::optional<GattDescriptor>)> callback);

    int rssi;
    uint64_t bluetoothAddress;
    std::optional<BluetoothLEDevice> device;
    winrt::event_token connectionToken;
    std::optional<GattSession> gattSession;
    winrt::event_token maxPduSizeChangedToken;
    std::unordered_map<winrt::guid, CachedService> cachedServices;

private:
    void GetServiceFromDevice(winrt::guid serviceUuid,
                              std::function<void(std::optional<GattDeviceService>)> callback);
    void
    GetCharacteristicFromService(GattDeviceService service, winrt::guid characteristicUuid,
                                 std::function<void(std::optional<GattCharacteristic>)> callback);
    void
    GetDescriptorFromCharacteristic(GattCharacteristic characteristic, winrt::guid descriptorUuid,
                                    std::function<void(std::optional<GattDescriptor>)> callback);
    void ProcessServiceData(const BluetoothLEAdvertisementDataSection& ds, size_t uuidSize);
};
