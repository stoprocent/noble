import CoreBluetooth
import Foundation

// Conversions between the C boundary (noble_mac_bridge.h), noble's string
// conventions and CoreBluetooth's types.
//
// noble speaks lowercase hex without dashes for both peripheral ids and UUIDs;
// CoreBluetooth speaks `UUID` / `CBUUID`.

// MARK: - Errors

/// A request that cannot be carried out. The message is what the JavaScript promise rejects with.
struct RequestError: Error {
    let message: String

    init(_ message: String) {
        self.message = message
    }
}

// MARK: - Hex

private func hexDigitValue(_ character: UInt8) -> UInt8? {
    switch character {
    case 48...57: // 0-9
        return character - 48
    case 65...70: // A-F
        return character - 55
    case 97...102: // a-f
        return character - 87
    default:
        return nil
    }
}

/// Decodes a string made of hex digit pairs. `nil` when anything else is in it.
private func bytes(fromHex hex: String) -> [UInt8]? {
    let digits = Array(hex.utf8)
    guard digits.count % 2 == 0 else {
        return nil
    }
    var result: [UInt8] = []
    result.reserveCapacity(digits.count / 2)
    var index = 0
    while index < digits.count {
        guard let high = hexDigitValue(digits[index]), let low = hexDigitValue(digits[index + 1]) else {
            return nil
        }
        result.append((high << 4) | low)
        index += 2
    }
    return result
}

private func strippingDashes(_ string: String) -> String {
    return string.replacingOccurrences(of: "-", with: "")
}

// MARK: - UUIDs

/// noble's spelling of a GATT UUID: `180a`, `6e400001b5a3f393e0a9e50e24dcca9e`.
func nobleString(_ uuid: CBUUID) -> String {
    return strippingDashes(uuid.uuidString).lowercased()
}

/// noble's spelling of a peripheral identifier.
func nobleString(_ identifier: UUID) -> String {
    return strippingDashes(identifier.uuidString).lowercased()
}

/// Normalises a peripheral id coming from JavaScript so it can be used as a dictionary key.
func normalizedPeripheralId(_ string: String) -> String {
    return strippingDashes(string).lowercased()
}

/// Parses a 16, 32 or 128 bit UUID, with or without dashes.
///
/// `CBUUID(string:)` raises an Objective-C exception on malformed input, which
/// Swift cannot catch, so the string is validated and decoded by hand.
func parseCBUUID(_ string: String) -> CBUUID? {
    guard let decoded = bytes(fromHex: strippingDashes(string)) else {
        return nil
    }
    guard decoded.count == 2 || decoded.count == 4 || decoded.count == 16 else {
        return nil
    }
    return CBUUID(data: Data(decoded))
}

/// Parses a peripheral id (32 hex digits, dashes optional) into the identifier CoreBluetooth uses.
func parsePeripheralIdentifier(_ string: String) -> UUID? {
    let hex = strippingDashes(string)
    guard let decoded = bytes(fromHex: hex), decoded.count == 16 else {
        return nil
    }
    let digits = Array(hex)
    let dashed = String(digits[0..<8]) + "-" + String(digits[8..<12]) + "-" + String(digits[12..<16]) + "-"
        + String(digits[16..<20]) + "-" + String(digits[20..<32])
    return UUID(uuidString: dashed)
}

// MARK: - Adapter state

func stateName(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOff:
        return "poweredOff"
    case .poweredOn:
        return "poweredOn"
    case .resetting:
        return "resetting"
    case .unauthorized:
        return "unauthorized"
    case .unsupported:
        return "unsupported"
    case .unknown:
        return "unknown"
    @unknown default:
        return "unknown"
    }
}

// MARK: - Values reported to JavaScript

struct CharacteristicSummary {
    let uuid: String
    /// `CBCharacteristicProperties` raw value; the glue turns the bits into names.
    let properties: UInt32
}

struct ServiceDataEntry {
    let uuid: String
    let data: Data
}

/// One sighting of a peripheral, in noble's terms.
struct Discovery {
    var peripheralId: String
    var address: String
    var addressType: String
    var connectable: Bool
    var localName: String?
    var txPowerLevel: Int32?
    var manufacturerData: Data?
    var serviceData: [ServiceDataEntry]
    var serviceUuids: [String]
    var rssi: Int32
}

/// The descriptor value as bytes. CoreBluetooth hands out `Data`, `String` or
/// `NSNumber` depending on the descriptor type.
func descriptorBytes(_ value: Any?) -> Data {
    if let data = value as? Data {
        return data
    }
    if let string = value as? String {
        return Data(string.utf8)
    }
    if let number = value as? NSNumber {
        return Data(number.stringValue.utf8)
    }
    return Data()
}

// MARK: - Reading C arguments

// Everything the glue passes in is only valid until the entry point returns,
// so these copy into Swift values.

func copyString(_ pointer: UnsafePointer<CChar>?) -> String {
    guard let pointer = pointer else {
        return ""
    }
    return String(cString: pointer)
}

func copyStrings(_ pointer: UnsafePointer<UnsafePointer<CChar>?>?, _ count: Int) -> [String] {
    guard let pointer = pointer, count > 0 else {
        return []
    }
    var result: [String] = []
    result.reserveCapacity(count)
    for index in 0..<count {
        if let item = pointer[index] {
            result.append(String(cString: item))
        }
    }
    return result
}

func copyData(_ pointer: UnsafePointer<UInt8>?, _ length: Int) -> Data {
    guard let pointer = pointer, length > 0 else {
        return Data()
    }
    return Data(bytes: pointer, count: length)
}

// MARK: - Building C arguments

/// Owns the temporary C memory handed to the glue for the duration of one call.
final class CAllocations {
    private var releases: [() -> Void] = []

    deinit {
        release()
    }

    func release() {
        for action in releases {
            action()
        }
        releases.removeAll()
    }

    func string(_ value: String) -> UnsafePointer<CChar>? {
        guard let copy = strdup(value) else {
            return nil
        }
        releases.append { free(copy) }
        return UnsafePointer<CChar>(copy)
    }

    func strings(_ values: [String]) -> UnsafePointer<UnsafePointer<CChar>?>? {
        var pointers: [UnsafePointer<CChar>?] = []
        pointers.reserveCapacity(values.count)
        for value in values {
            pointers.append(string(value))
        }
        return array(pointers)
    }

    func bytes(_ data: Data) -> UnsafePointer<UInt8>? {
        return array([UInt8](data))
    }

    /// `nil` for an empty array: the count that travels with the pointer says so.
    func array<Element>(_ values: [Element]) -> UnsafePointer<Element>? {
        let count = values.count
        guard count > 0 else {
            return nil
        }
        let buffer = UnsafeMutablePointer<Element>.allocate(capacity: count)
        for index in 0..<count {
            (buffer + index).initialize(to: values[index])
        }
        releases.append {
            buffer.deinitialize(count: count)
            buffer.deallocate()
        }
        return UnsafePointer<Element>(buffer)
    }
}
