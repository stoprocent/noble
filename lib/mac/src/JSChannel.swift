import Foundation

/// The way out of the Swift core: results of requests and unsolicited
/// notifications, delivered to the N-API glue through the C functions declared
/// in noble_mac_bridge.h.
///
/// Only ever used on the manager's dispatch queue. The glue copies everything
/// before returning, so all C memory built here lives for one call only.
final class JSChannel {
    private let context: UnsafeMutableRawPointer?
    private var isOpen = true

    init(context: UnsafeMutableRawPointer?) {
        self.context = context
    }

    /// After this nothing reaches the glue any more: its context is about to be freed.
    func close() {
        isOpen = false
    }

    // MARK: Results

    func resolve(_ requestId: UInt64) {
        guard isOpen else {
            return
        }
        noble_mac_resolve_void(context, requestId)
    }

    func resolve(_ requestId: UInt64, number: Int32) {
        guard isOpen else {
            return
        }
        noble_mac_resolve_number(context, requestId, number)
    }

    func resolve(_ requestId: UInt64, data: Data) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }
        noble_mac_resolve_data(context, requestId, pool.bytes(data), data.count)
    }

    func resolve(_ requestId: UInt64, strings: [String]) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }
        noble_mac_resolve_strings(context, requestId, pool.strings(strings), strings.count)
    }

    func resolve(_ requestId: UInt64, characteristics: [CharacteristicSummary]) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }
        var items: [NobleMacCharacteristic] = []
        items.reserveCapacity(characteristics.count)
        for characteristic in characteristics {
            var item = NobleMacCharacteristic()
            item.uuid = pool.string(characteristic.uuid)
            item.properties = characteristic.properties
            items.append(item)
        }
        noble_mac_resolve_characteristics(context, requestId, pool.array(items), items.count)
    }

    func reject(_ requestId: UInt64, _ message: String) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }
        noble_mac_reject(context, requestId, pool.string(message))
    }

    // MARK: Notifications

    func stateChanged(_ state: String) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }
        noble_mac_on_state_change(context, pool.string(state))
    }

    func scanStarted(filterDuplicates: Bool) {
        guard isOpen else {
            return
        }
        noble_mac_on_scan_start(context, filterDuplicates)
    }

    func scanStopped() {
        guard isOpen else {
            return
        }
        noble_mac_on_scan_stop(context)
    }

    func discovered(_ discovery: Discovery) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }

        var serviceData: [NobleMacServiceData] = []
        serviceData.reserveCapacity(discovery.serviceData.count)
        for entry in discovery.serviceData {
            var item = NobleMacServiceData()
            item.uuid = pool.string(entry.uuid)
            item.data = pool.bytes(entry.data)
            item.length = entry.data.count
            serviceData.append(item)
        }

        var value = NobleMacDiscovery()
        value.peripheralId = pool.string(discovery.peripheralId)
        value.address = pool.string(discovery.address)
        value.addressType = pool.string(discovery.addressType)
        value.connectable = discovery.connectable
        if let localName = discovery.localName {
            value.localName = pool.string(localName)
        } else {
            value.localName = nil
        }
        if let txPowerLevel = discovery.txPowerLevel {
            value.hasTxPowerLevel = true
            value.txPowerLevel = txPowerLevel
        } else {
            value.hasTxPowerLevel = false
            value.txPowerLevel = 0
        }
        if let manufacturerData = discovery.manufacturerData {
            value.hasManufacturerData = true
            value.manufacturerData = pool.bytes(manufacturerData)
            value.manufacturerDataLength = manufacturerData.count
        } else {
            value.hasManufacturerData = false
            value.manufacturerData = nil
            value.manufacturerDataLength = 0
        }
        value.serviceData = pool.array(serviceData)
        value.serviceDataCount = serviceData.count
        value.serviceUuids = pool.strings(discovery.serviceUuids)
        value.serviceUuidCount = discovery.serviceUuids.count
        value.rssi = discovery.rssi

        withUnsafePointer(to: &value) { pointer in
            noble_mac_on_discover(context, pointer)
        }
    }

    func connected(_ peripheralId: String) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }
        noble_mac_on_connect(context, pool.string(peripheralId))
    }

    func disconnected(_ peripheralId: String, reason: String) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }
        noble_mac_on_disconnect(context, pool.string(peripheralId), pool.string(reason))
    }

    func mtuChanged(_ peripheralId: String, mtu: Int32) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }
        noble_mac_on_mtu(context, pool.string(peripheralId), mtu)
    }

    func rssiUpdated(_ peripheralId: String, rssi: Int32) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }
        noble_mac_on_rssi(context, pool.string(peripheralId), rssi)
    }

    func notification(_ peripheralId: String, service: String, characteristic: String, data: Data) {
        guard isOpen else {
            return
        }
        let pool = CAllocations()
        defer { pool.release() }
        noble_mac_on_notification(
            context, pool.string(peripheralId), pool.string(service), pool.string(characteristic),
            pool.bytes(data), data.count)
    }
}
