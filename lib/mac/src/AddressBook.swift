import Foundation

/// Looks up the MAC address CoreBluetooth has cached for a peripheral.
///
/// CoreBluetooth itself never exposes addresses; the only source is the
/// system's Bluetooth preferences, which may or may not list a device (and on
/// recent macOS versions usually do not). Unknown devices get an empty address
/// and the `unknown` address type.
final class AddressBook {
    struct Entry {
        let address: String
        let addressType: String
    }

    private static let preferencesPath = "/Library/Preferences/com.apple.Bluetooth.plist"
    /// Advertisements arrive many times per second; the file is not re-read for each of them.
    private static let refreshInterval: TimeInterval = 10

    private var cache: [String: Any] = [:]
    private var loadedAt: Date?

    func lookup(_ identifier: UUID) -> Entry {
        refreshIfNeeded()
        guard let record = cache[identifier.uuidString] as? [String: Any] else {
            return Entry(address: "", addressType: "unknown")
        }
        var addressType = "unknown"
        if let rawType = record["DeviceAddressType"] as? NSNumber {
            addressType = rawType.boolValue ? "random" : "public"
        }
        let address = (record["DeviceAddress"] as? String) ?? ""
        return Entry(address: address, addressType: addressType)
    }

    private func refreshIfNeeded() {
        let now = Date()
        if let loadedAt = loadedAt, now.timeIntervalSince(loadedAt) < AddressBook.refreshInterval {
            return
        }
        loadedAt = now
        var fresh: [String: Any] = [:]
        if let preferences = NSDictionary(contentsOfFile: AddressBook.preferencesPath),
           let devices = preferences["CoreBluetoothCache"] as? [String: Any] {
            fresh = devices
        }
        cache = fresh
    }
}
