//
//  radio_watcher.h
//  noble-winrt-native
//
//  Created by Georg Vienna on 07.09.18.
//

#pragma once

// Standard library includes
#include <functional>
#include <set>

// Windows Runtime includes
#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Devices.Radios.h>
#include <winrt/Windows.Foundation.h>

// Forward declarations
using namespace winrt::Windows::Devices::Enumeration;
using winrt::Windows::Devices::Radios::IRadio;
using winrt::Windows::Devices::Radios::Radio;
using winrt::Windows::Devices::Radios::RadioState;
using winrt::Windows::Foundation::IAsyncOperation;
using winrt::Windows::Foundation::IInspectable;

// AdapterState enum
enum class AdapterState : int32_t
{
    Initial = -2,
    Unsupported = -1,
    Unknown = (int32_t)RadioState::Unknown,
    On = (int32_t)RadioState::On,
    Off = (int32_t)RadioState::Off,
    Disabled = (int32_t)RadioState::Disabled,
};

// AdapterCapabilities struct
struct AdapterCapabilities {
    uint64_t bluetoothAddress;
    bool classicSecureConnectionsSupported;
    bool lowEnergySecureConnectionsSupported;
    bool extendedAdvertisingSupported;
    bool lowEnergySupported;
    uint32_t maxAdvertisementDataLength;
    bool peripheralRoleSupported;
    bool centralRoleSupported;
};

// Convert AdapterState to std:string
const char* adapterStateToString(AdapterState state);

// RadioWatcher class
class RadioWatcher
{
public:
    RadioWatcher();

    void Start(std::function<void(Radio& radio, const AdapterCapabilities& capabilities)> on);

    winrt::fire_and_forget OnRadioChanged();

    void OnAdded(DeviceWatcher watcher, DeviceInformation info);
    void OnUpdated(DeviceWatcher watcher, DeviceInformationUpdate info);
    void OnRemoved(DeviceWatcher watcher, DeviceInformationUpdate info);
    void OnCompleted(DeviceWatcher watcher, IInspectable info);

private:
    Radio mRadio;
    DeviceWatcher watcher;
    bool inEnumeration;
    
    std::function<void(Radio& radio, const AdapterCapabilities& capabilities)> radioStateChanged;
    
    winrt::event_revoker<IDeviceWatcher> mAddedRevoker;
    winrt::event_revoker<IDeviceWatcher> mUpdatedRevoker;
    winrt::event_revoker<IDeviceWatcher> mRemovedRevoker;
    winrt::event_revoker<IDeviceWatcher> mCompletedRevoker;
    winrt::event_revoker<IRadio> mRadioStateChangedRevoker;
};
