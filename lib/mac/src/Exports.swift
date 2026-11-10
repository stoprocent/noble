import Foundation

// The C entry points of the Swift core, declared in noble_mac_bridge.h and
// called by the N-API glue on the JavaScript thread.
//
// Every pointer argument is copied into a Swift value before the function
// returns; the actual work happens later on the manager's dispatch queue.

private func manager(_ handle: UnsafeMutableRawPointer?) -> BLEManager? {
    guard let handle = handle else {
        return nil
    }
    return Unmanaged<BLEManager>.fromOpaque(handle).takeUnretainedValue()
}

// MARK: - Lifecycle

/// Creates the manager. `context` is handed back to the glue with every result
/// and notification. The returned handle owns the manager until `noble_mac_destroy`.
@_cdecl("noble_mac_create")
public func nobleMacCreate(_ context: UnsafeMutableRawPointer?) -> UnsafeMutableRawPointer? {
    let instance = BLEManager(context: context)
    instance.start()
    return Unmanaged.passRetained(instance).toOpaque()
}

/// Shuts the manager down and releases it. Blocks until its queue is idle:
/// once this returns the glue is never called with the manager's context again.
@_cdecl("noble_mac_destroy")
public func nobleMacDestroy(_ handle: UnsafeMutableRawPointer?) {
    guard let handle = handle else {
        return
    }
    let instance = Unmanaged<BLEManager>.fromOpaque(handle).takeRetainedValue()
    instance.shutdown()
}

// MARK: - Scanning

@_cdecl("noble_mac_start_scanning")
public func nobleMacStartScanning(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64,
    _ serviceUuids: UnsafePointer<UnsafePointer<CChar>?>?, _ serviceUuidCount: Int,
    _ allowDuplicates: Bool
) {
    manager(handle)?.startScanning(
        requestId: requestId, serviceUuids: copyStrings(serviceUuids, serviceUuidCount),
        allowDuplicates: allowDuplicates)
}

@_cdecl("noble_mac_stop_scanning")
public func nobleMacStopScanning(_ handle: UnsafeMutableRawPointer?, _ requestId: UInt64) {
    manager(handle)?.stopScanning(requestId: requestId)
}

// MARK: - Connection

@_cdecl("noble_mac_connect")
public func nobleMacConnect(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?
) {
    manager(handle)?.connect(requestId: requestId, peripheralId: copyString(peripheralId))
}

@_cdecl("noble_mac_cancel_connect")
public func nobleMacCancelConnect(_ handle: UnsafeMutableRawPointer?, _ peripheralId: UnsafePointer<CChar>?) {
    manager(handle)?.cancelConnect(peripheralId: copyString(peripheralId))
}

@_cdecl("noble_mac_disconnect")
public func nobleMacDisconnect(_ handle: UnsafeMutableRawPointer?, _ peripheralId: UnsafePointer<CChar>?) {
    manager(handle)?.disconnect(peripheralId: copyString(peripheralId))
}

@_cdecl("noble_mac_update_rssi")
public func nobleMacUpdateRSSI(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?
) {
    manager(handle)?.updateRSSI(requestId: requestId, peripheralId: copyString(peripheralId))
}

// MARK: - Services and characteristics

@_cdecl("noble_mac_discover_services")
public func nobleMacDiscoverServices(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ serviceUuids: UnsafePointer<UnsafePointer<CChar>?>?, _ serviceUuidCount: Int
) {
    manager(handle)?.discoverServices(
        requestId: requestId, peripheralId: copyString(peripheralId),
        serviceUuids: copyStrings(serviceUuids, serviceUuidCount))
}

@_cdecl("noble_mac_discover_included_services")
public func nobleMacDiscoverIncludedServices(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ serviceUuid: UnsafePointer<CChar>?,
    _ serviceUuids: UnsafePointer<UnsafePointer<CChar>?>?, _ serviceUuidCount: Int
) {
    manager(handle)?.discoverIncludedServices(
        requestId: requestId, peripheralId: copyString(peripheralId), serviceUuid: copyString(serviceUuid),
        serviceUuids: copyStrings(serviceUuids, serviceUuidCount))
}

@_cdecl("noble_mac_discover_characteristics")
public func nobleMacDiscoverCharacteristics(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ serviceUuid: UnsafePointer<CChar>?,
    _ characteristicUuids: UnsafePointer<UnsafePointer<CChar>?>?, _ characteristicUuidCount: Int
) {
    manager(handle)?.discoverCharacteristics(
        requestId: requestId, peripheralId: copyString(peripheralId), serviceUuid: copyString(serviceUuid),
        characteristicUuids: copyStrings(characteristicUuids, characteristicUuidCount))
}

@_cdecl("noble_mac_read")
public func nobleMacRead(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ serviceUuid: UnsafePointer<CChar>?, _ characteristicUuid: UnsafePointer<CChar>?
) {
    manager(handle)?.read(
        requestId: requestId, peripheralId: copyString(peripheralId), serviceUuid: copyString(serviceUuid),
        characteristicUuid: copyString(characteristicUuid))
}

@_cdecl("noble_mac_write")
public func nobleMacWrite(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ serviceUuid: UnsafePointer<CChar>?, _ characteristicUuid: UnsafePointer<CChar>?,
    _ data: UnsafePointer<UInt8>?, _ length: Int, _ withoutResponse: Bool
) {
    manager(handle)?.write(
        requestId: requestId, peripheralId: copyString(peripheralId), serviceUuid: copyString(serviceUuid),
        characteristicUuid: copyString(characteristicUuid), data: copyData(data, length),
        withoutResponse: withoutResponse)
}

@_cdecl("noble_mac_notify")
public func nobleMacNotify(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ serviceUuid: UnsafePointer<CChar>?, _ characteristicUuid: UnsafePointer<CChar>?, _ enable: Bool
) {
    manager(handle)?.notify(
        requestId: requestId, peripheralId: copyString(peripheralId), serviceUuid: copyString(serviceUuid),
        characteristicUuid: copyString(characteristicUuid), enable: enable)
}

// MARK: - Descriptors

@_cdecl("noble_mac_discover_descriptors")
public func nobleMacDiscoverDescriptors(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ serviceUuid: UnsafePointer<CChar>?, _ characteristicUuid: UnsafePointer<CChar>?
) {
    manager(handle)?.discoverDescriptors(
        requestId: requestId, peripheralId: copyString(peripheralId), serviceUuid: copyString(serviceUuid),
        characteristicUuid: copyString(characteristicUuid))
}

@_cdecl("noble_mac_read_value")
public func nobleMacReadValue(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ serviceUuid: UnsafePointer<CChar>?, _ characteristicUuid: UnsafePointer<CChar>?,
    _ descriptorUuid: UnsafePointer<CChar>?
) {
    manager(handle)?.readValue(
        requestId: requestId, peripheralId: copyString(peripheralId), serviceUuid: copyString(serviceUuid),
        characteristicUuid: copyString(characteristicUuid), descriptorUuid: copyString(descriptorUuid))
}

@_cdecl("noble_mac_write_value")
public func nobleMacWriteValue(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ serviceUuid: UnsafePointer<CChar>?, _ characteristicUuid: UnsafePointer<CChar>?,
    _ descriptorUuid: UnsafePointer<CChar>?, _ data: UnsafePointer<UInt8>?, _ length: Int
) {
    manager(handle)?.writeValue(
        requestId: requestId, peripheralId: copyString(peripheralId), serviceUuid: copyString(serviceUuid),
        characteristicUuid: copyString(characteristicUuid), descriptorUuid: copyString(descriptorUuid),
        data: copyData(data, length))
}

// MARK: - Handles

@_cdecl("noble_mac_read_handle")
public func nobleMacReadHandle(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ attributeHandle: Int32
) {
    manager(handle)?.readHandle(
        requestId: requestId, peripheralId: copyString(peripheralId), handle: Int(attributeHandle))
}

@_cdecl("noble_mac_write_handle")
public func nobleMacWriteHandle(
    _ handle: UnsafeMutableRawPointer?, _ requestId: UInt64, _ peripheralId: UnsafePointer<CChar>?,
    _ attributeHandle: Int32, _ data: UnsafePointer<UInt8>?, _ length: Int, _ withoutResponse: Bool
) {
    manager(handle)?.writeHandle(
        requestId: requestId, peripheralId: copyString(peripheralId), handle: Int(attributeHandle),
        data: copyData(data, length), withoutResponse: withoutResponse)
}
