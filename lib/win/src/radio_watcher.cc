// Standard library includes
#include <future>
#include <string>
#include <sstream>
#include <iomanip>
#include <cstdint>

// Windows Runtime includes
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Devices.Bluetooth.h>
#include <winrt/Windows.Devices.Enumeration.h>
#include <winrt/Windows.Devices.Radios.h>

// Project includes
#include "radio_watcher.h"
#include "winrt_cpp.h"

using namespace winrt::Windows::Devices::Enumeration;
using namespace winrt::Windows::Devices::Bluetooth;
using namespace winrt::Windows::Devices::Bluetooth::GenericAttributeProfile;
using winrt::Windows::Devices::Radios::RadioState;

template <typename O, typename M, class... Types> auto bind2(O* object, M method, Types&... args)
{
    return std::bind(method, object, std::placeholders::_1, std::placeholders::_2, args...);
}

const char* adapterStateToString(AdapterState state)
{
    switch (state)
    {
    case AdapterState::Unsupported:
        return "unsupported";
    case AdapterState::On:
        return "poweredOn";
        break;
    case AdapterState::Off:
        return "poweredOff";
        break;
    case AdapterState::Disabled:
        return "poweredOff";
        break;
    default:
        return "unknown";
    }
}

RadioWatcher::RadioWatcher()
    : mRadio(nullptr), watcher(DeviceInformation::CreateWatcher(BluetoothAdapter::GetDeviceSelector()))
{
    mAddedRevoker = watcher.Added(winrt::auto_revoke, bind2(this, &RadioWatcher::OnAdded));
    mUpdatedRevoker = watcher.Updated(winrt::auto_revoke, bind2(this, &RadioWatcher::OnUpdated));
    mRemovedRevoker = watcher.Removed(winrt::auto_revoke, bind2(this, &RadioWatcher::OnRemoved));
    auto completed = bind2(this, &RadioWatcher::OnCompleted);
    mCompletedRevoker = watcher.EnumerationCompleted(winrt::auto_revoke, completed);
}

void RadioWatcher::Start(std::function<void(Radio& radio, const AdapterCapabilities& capabilities)> on)
{
    radioStateChanged = on;
    inEnumeration = true;
    watcher.Start();
}

winrt::fire_and_forget RadioWatcher::OnRadioChanged() {
    try {
        auto adapter = co_await BluetoothAdapter::GetDefaultAsync();
        
        if (adapter) {
            auto radio = co_await adapter.GetRadioAsync();

            AdapterCapabilities capabilities;
            capabilities.bluetoothAddress = adapter.BluetoothAddress();
            capabilities.classicSecureConnectionsSupported = adapter.AreClassicSecureConnectionsSupported();
            capabilities.lowEnergySecureConnectionsSupported = adapter.AreLowEnergySecureConnectionsSupported();
            capabilities.extendedAdvertisingSupported = adapter.IsExtendedAdvertisingSupported();
            capabilities.lowEnergySupported = adapter.IsLowEnergySupported();
            capabilities.maxAdvertisementDataLength = adapter.MaxAdvertisementDataLength();
            capabilities.peripheralRoleSupported = adapter.IsPeripheralRoleSupported();
            capabilities.centralRoleSupported = adapter.IsCentralRoleSupported();

            Radio bluetooth = nullptr;
            if(adapter.IsCentralRoleSupported())
            {
                // Always set up radio state monitoring for any radio (on or off)
                bluetooth = radio;
                mRadioStateChangedRevoker.revoke();
                mRadioStateChangedRevoker = radio.StateChanged(
                    winrt::auto_revoke, 
                    [this, capabilities](Radio radio, auto&&) { 
                        Radio bluetooth = radio;
                        radioStateChanged(bluetooth, capabilities); 
                    });
                
                radioStateChanged(bluetooth, capabilities);
                mRadio = bluetooth;
                
            }
            else
            {
                mRadioStateChangedRevoker.revoke();
                radioStateChanged(bluetooth, capabilities);
                mRadio = bluetooth;
            }
        } else {
            mRadio = nullptr;
            mRadioStateChangedRevoker.revoke();
            AdapterCapabilities emptyCapabilities = {};
            radioStateChanged(mRadio, emptyCapabilities);
        }
    } catch (const winrt::hresult_error&) {
        mRadio = nullptr;
        mRadioStateChangedRevoker.revoke();
        AdapterCapabilities emptyCapabilities = {};
        radioStateChanged(mRadio, emptyCapabilities);
    }
}

void RadioWatcher::OnAdded(DeviceWatcher watcher, DeviceInformation info)
{
    if (inEnumeration) { return; }
    OnRadioChanged();
}

void RadioWatcher::OnUpdated(DeviceWatcher watcher, DeviceInformationUpdate info)
{
    OnRadioChanged();
}

void RadioWatcher::OnRemoved(DeviceWatcher watcher, DeviceInformationUpdate info)
{
    OnRadioChanged();
}

void RadioWatcher::OnCompleted(DeviceWatcher watcher, IInspectable info)
{
    inEnumeration = false;
    OnRadioChanged();
}
