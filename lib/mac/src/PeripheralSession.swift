import CoreBluetooth
import Foundation

/// What a pending request is waiting for.
///
/// CoreBluetooth reports completions through delegate callbacks that only say
/// *which object* an operation finished on, so that is what requests are keyed
/// by. Two requests for the same operation on the same object are answered in
/// the order they were made.
enum PendingOperation: Hashable {
    case connect
    case readRSSI
    case discoverServices
    case discoverIncludedServices(service: String)
    case discoverCharacteristics(service: String)
    case read(service: String, characteristic: String)
    case write(service: String, characteristic: String)
    case notify(service: String, characteristic: String)
    case discoverDescriptors(service: String, characteristic: String)
    case readDescriptor(service: String, characteristic: String, descriptor: String)
    case writeDescriptor(service: String, characteristic: String, descriptor: String)
}

/// FIFO queues of request ids, one per pending operation.
struct PendingRequests {
    private var queues: [PendingOperation: [UInt64]] = [:]

    var isEmpty: Bool {
        return queues.isEmpty
    }

    mutating func enqueue(_ requestId: UInt64, for operation: PendingOperation) {
        var queue = queues[operation] ?? []
        queue.append(requestId)
        queues[operation] = queue
    }

    /// The oldest request waiting for `operation`, if any.
    mutating func dequeue(_ operation: PendingOperation) -> UInt64? {
        guard var queue = queues[operation], !queue.isEmpty else {
            return nil
        }
        let requestId = queue.removeFirst()
        if queue.isEmpty {
            queues.removeValue(forKey: operation)
        } else {
            queues[operation] = queue
        }
        return requestId
    }

    /// Every request waiting for `operation`, oldest first.
    mutating func dequeueAll(_ operation: PendingOperation) -> [UInt64] {
        return queues.removeValue(forKey: operation) ?? []
    }

    /// Empties the bookkeeping and returns everything that was waiting, oldest first.
    mutating func removeAll() -> [UInt64] {
        var all: [UInt64] = []
        for queue in queues.values {
            all.append(contentsOf: queue)
        }
        queues.removeAll()
        // Request ids are handed out in increasing order.
        all.sort()
        return all
    }
}

/// A peripheral this process asked CoreBluetooth to connect to, together with
/// the requests still waiting for an answer from it.
final class PeripheralSession {
    /// noble's id: the CoreBluetooth identifier as lowercase hex without dashes.
    let id: String
    /// Strong reference: CoreBluetooth drops peripherals nobody retains.
    let peripheral: CBPeripheral
    var pending = PendingRequests()
    /// Whether the link is up, i.e. `didConnect` was seen and `didDisconnect` was not.
    var isConnected = false
    /// The last MTU reported to JavaScript, to only report changes.
    var reportedMTU: Int?

    init(id: String, peripheral: CBPeripheral) {
        self.id = id
        self.peripheral = peripheral
    }
}

// MARK: - GATT object identity

// `service` / `characteristic` back-references became optional (weak) in the
// macOS 12 SDK; binding them to an explicitly optional constant compiles
// against both spellings.

func serviceKey(of characteristic: CBCharacteristic) -> String {
    let service: CBService? = characteristic.service
    guard let owner = service else {
        return ""
    }
    return nobleString(owner.uuid)
}

func characteristicOwner(of descriptor: CBDescriptor) -> CBCharacteristic? {
    let characteristic: CBCharacteristic? = descriptor.characteristic
    return characteristic
}

extension PendingOperation {
    static func reading(_ characteristic: CBCharacteristic) -> PendingOperation {
        return .read(service: serviceKey(of: characteristic), characteristic: nobleString(characteristic.uuid))
    }

    static func writing(_ characteristic: CBCharacteristic) -> PendingOperation {
        return .write(service: serviceKey(of: characteristic), characteristic: nobleString(characteristic.uuid))
    }

    static func settingNotify(_ characteristic: CBCharacteristic) -> PendingOperation {
        return .notify(service: serviceKey(of: characteristic), characteristic: nobleString(characteristic.uuid))
    }

    static func discoveringDescriptors(_ characteristic: CBCharacteristic) -> PendingOperation {
        return .discoverDescriptors(
            service: serviceKey(of: characteristic), characteristic: nobleString(characteristic.uuid))
    }

    static func readingDescriptor(_ descriptor: CBDescriptor) -> PendingOperation {
        let keys = descriptorKeys(descriptor)
        return .readDescriptor(service: keys.service, characteristic: keys.characteristic, descriptor: keys.descriptor)
    }

    static func writingDescriptor(_ descriptor: CBDescriptor) -> PendingOperation {
        let keys = descriptorKeys(descriptor)
        return .writeDescriptor(service: keys.service, characteristic: keys.characteristic, descriptor: keys.descriptor)
    }

    private static func descriptorKeys(
        _ descriptor: CBDescriptor
    ) -> (service: String, characteristic: String, descriptor: String) {
        guard let owner = characteristicOwner(of: descriptor) else {
            return ("", "", nobleString(descriptor.uuid))
        }
        return (serviceKey(of: owner), nobleString(owner.uuid), nobleString(descriptor.uuid))
    }
}
