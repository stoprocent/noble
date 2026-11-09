import CoreBluetooth
import Foundation

/// The CoreBluetooth side of noble's macOS backend.
///
/// CoreBluetooth is delegate based while noble's `Bindings` contract is
/// request / response, so this class is where the two are matched up: every
/// request carries the id of the JavaScript promise waiting for it, is parked
/// in the `PendingRequests` of its peripheral, and is settled from the delegate
/// callback that reports the outcome.
///
/// Threading: the request methods may be called from any thread (in practice
/// the JavaScript thread). They hop onto `queue`, the serial queue that also
/// receives every CoreBluetooth callback, so all state below is confined to it.
final class BLEManager: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private let queue = DispatchQueue(label: "noble.mac.corebluetooth")
    private let js: JSChannel
    private let addressBook = AddressBook()

    private var central: CBCentralManager?
    private var lastState: CBManagerState = .unknown
    private var stateTimer: DispatchSourceTimer?
    private var isShutDown = false

    /// Peripherals a connection was requested for, by noble id.
    private var sessions: [String: PeripheralSession] = [:]
    /// Ids reported to JavaScript since the last scan started.
    private var discovered = Set<String>()

    init(context: UnsafeMutableRawPointer?) {
        js = JSChannel(context: context)
        super.init()
    }

    // MARK: - Lifecycle

    /// Creates the central manager. Its first state update follows on `queue`.
    func start() {
        queue.async {
            guard !self.isShutDown, self.central == nil else {
                return
            }
            self.central = CBCentralManager(delegate: self, queue: self.queue)
            self.startStateTimer()
        }
    }

    /// Stops everything and returns once the queue is quiet. Nothing is
    /// reported to the glue afterwards; whatever was pending is settled by the
    /// glue itself.
    func shutdown() {
        queue.sync {
            guard !self.isShutDown else {
                return
            }
            self.isShutDown = true
            self.js.close()

            self.stateTimer?.cancel()
            self.stateTimer = nil

            if let central = self.central {
                if central.state == .poweredOn {
                    if central.isScanning {
                        central.stopScan()
                    }
                    for session in self.sessions.values {
                        central.cancelPeripheralConnection(session.peripheral)
                    }
                }
                central.delegate = nil
            }
            for session in self.sessions.values {
                session.peripheral.delegate = nil
            }
            self.sessions.removeAll()
            self.discovered.removeAll()
            self.central = nil
        }
    }

    /// CoreBluetooth does not always report state changes across sleep / wake
    /// cycles, so the state is also polled.
    private func startStateTimer() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + .seconds(2), repeating: .seconds(2), leeway: .milliseconds(100))
        timer.setEventHandler { [weak self] in
            guard let self = self, !self.isShutDown, let central = self.central else {
                return
            }
            if central.state != self.lastState {
                self.centralManagerDidUpdateState(central)
            }
        }
        timer.resume()
        stateTimer = timer
    }

    // MARK: - Request plumbing

    /// Runs `work` on the queue unless the manager was shut down in the meantime.
    private func onQueue(_ work: @escaping () -> Void) {
        queue.async {
            if self.isShutDown {
                return
            }
            work()
        }
    }

    /// Runs the synchronous part of a request and rejects it when that part fails.
    private func attempt(_ requestId: UInt64, _ body: () throws -> Void) {
        do {
            try body()
        } catch let error as RequestError {
            js.reject(requestId, error.message)
        } catch {
            js.reject(requestId, error.localizedDescription)
        }
    }

    private func poweredOnCentral() throws -> CBCentralManager {
        guard let central = central else {
            throw RequestError("Bluetooth is not initialized")
        }
        guard central.state == .poweredOn else {
            throw RequestError("Bluetooth adapter is \(stateName(central.state)) (not poweredOn)")
        }
        return central
    }

    /// The session of a peripheral whose link is up.
    private func connectedSession(_ peripheralId: String) throws -> PeripheralSession {
        _ = try poweredOnCentral()
        let id = normalizedPeripheralId(peripheralId)
        guard let session = sessions[id], session.isConnected, session.peripheral.state == .connected else {
            throw RequestError("Peripheral \(id) is not connected")
        }
        return session
    }

    private func parseUUID(_ string: String) throws -> CBUUID {
        guard let uuid = parseCBUUID(string) else {
            throw RequestError("Invalid UUID '\(string)'")
        }
        return uuid
    }

    /// `nil` (meaning "everything") for an empty filter.
    private func parseFilter(_ strings: [String]) throws -> [CBUUID]? {
        if strings.isEmpty {
            return nil
        }
        var uuids: [CBUUID] = []
        uuids.reserveCapacity(strings.count)
        for string in strings {
            uuids.append(try parseUUID(string))
        }
        return uuids
    }

    private func findService(_ session: PeripheralSession, _ serviceUuid: String) throws -> CBService {
        let uuid = try parseUUID(serviceUuid)
        let services: [CBService] = session.peripheral.services ?? []
        for service in services where service.uuid == uuid {
            return service
        }
        throw RequestError("Service \(serviceUuid) was not discovered on peripheral \(session.id)")
    }

    private func findCharacteristic(
        _ session: PeripheralSession, _ serviceUuid: String, _ characteristicUuid: String
    ) throws -> CBCharacteristic {
        let service = try findService(session, serviceUuid)
        let uuid = try parseUUID(characteristicUuid)
        let characteristics: [CBCharacteristic] = service.characteristics ?? []
        for characteristic in characteristics where characteristic.uuid == uuid {
            return characteristic
        }
        throw RequestError("Characteristic \(characteristicUuid) was not discovered in service \(serviceUuid)")
    }

    private func findDescriptor(
        _ session: PeripheralSession, _ serviceUuid: String, _ characteristicUuid: String,
        _ descriptorUuid: String
    ) throws -> CBDescriptor {
        let characteristic = try findCharacteristic(session, serviceUuid, characteristicUuid)
        let uuid = try parseUUID(descriptorUuid)
        let descriptors: [CBDescriptor] = characteristic.descriptors ?? []
        for descriptor in descriptors where descriptor.uuid == uuid {
            return descriptor
        }
        throw RequestError(
            "Descriptor \(descriptorUuid) was not discovered in characteristic \(characteristicUuid)")
    }

    /// The ATT handle of a descriptor. CoreBluetooth keeps it private; it is
    /// read through KVC when (and only when) the object actually has it.
    private func handle(of descriptor: CBDescriptor) -> Int? {
        guard descriptor.responds(to: NSSelectorFromString("handle")) else {
            return nil
        }
        guard let number = descriptor.value(forKey: "handle") as? NSNumber else {
            return nil
        }
        return number.intValue
    }

    private func findDescriptor(_ session: PeripheralSession, handle wanted: Int) throws -> CBDescriptor {
        let services: [CBService] = session.peripheral.services ?? []
        for service in services {
            let characteristics: [CBCharacteristic] = service.characteristics ?? []
            for characteristic in characteristics {
                let descriptors: [CBDescriptor] = characteristic.descriptors ?? []
                for descriptor in descriptors {
                    if let found = handle(of: descriptor), found == wanted {
                        return descriptor
                    }
                }
            }
        }
        throw RequestError(
            "No discovered descriptor has handle \(wanted); "
                + "CoreBluetooth only supports handle access to discovered descriptors")
    }

    /// The client characteristic configuration descriptor cannot be written
    /// directly: CoreBluetooth raises an exception instead of failing the write.
    private func checkWritable(_ descriptor: CBDescriptor) throws {
        if descriptor.uuid == CBUUID(string: CBUUIDClientCharacteristicConfigurationString) {
            throw RequestError(
                "CoreBluetooth does not allow writing the client characteristic configuration descriptor; "
                    + "use notify() instead")
        }
    }

    private func knownSession(for peripheral: CBPeripheral) -> PeripheralSession? {
        return sessions[nobleString(peripheral.identifier)]
    }

    /// Settles the oldest request waiting for `operation`, if there is one.
    private func settle(
        _ session: PeripheralSession, _ operation: PendingOperation, error: Error?,
        success: (UInt64) -> Void
    ) {
        guard let requestId = session.pending.dequeue(operation) else {
            return
        }
        if let error = error {
            js.reject(requestId, error.localizedDescription)
        } else {
            success(requestId)
        }
    }

    private func rejectAll(_ session: PeripheralSession, _ message: String) {
        for requestId in session.pending.removeAll() {
            js.reject(requestId, message)
        }
    }

    /// Reports the MTU when it changed. CoreBluetooth only exposes the largest
    /// write-without-response payload, which is what noble has always reported here.
    private func reportMTU(_ session: PeripheralSession) {
        let mtu = session.peripheral.maximumWriteValueLength(for: .withoutResponse)
        if session.reportedMTU != mtu {
            session.reportedMTU = mtu
            js.mtuChanged(session.id, mtu: Int32(truncatingIfNeeded: mtu))
        }
    }

    // MARK: - Scanning

    func startScanning(requestId: UInt64, serviceUuids: [String], allowDuplicates: Bool) {
        onQueue {
            self.attempt(requestId) {
                let central = try self.poweredOnCentral()
                let services = try self.parseFilter(serviceUuids)
                self.discovered.removeAll()
                let options: [String: Any] = [
                    CBCentralManagerScanOptionAllowDuplicatesKey: NSNumber(value: allowDuplicates)
                ]
                central.scanForPeripherals(withServices: services, options: options)
                self.js.resolve(requestId)
                self.js.scanStarted(filterDuplicates: !allowDuplicates)
            }
        }
    }

    func stopScanning(requestId: UInt64) {
        onQueue {
            if let central = self.central, central.state == .poweredOn {
                central.stopScan()
            }
            self.js.resolve(requestId)
            self.js.scanStopped()
        }
    }

    func centralManager(
        _ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any], rssi RSSI: NSNumber
    ) {
        guard !isShutDown else {
            return
        }
        reportDiscovery(peripheral, advertisementData: advertisementData, rssi: RSSI.int32Value)
    }

    private func reportDiscovery(_ peripheral: CBPeripheral, advertisementData: [String: Any], rssi: Int32) {
        let id = nobleString(peripheral.identifier)
        discovered.insert(id)

        let known = addressBook.lookup(peripheral.identifier)

        var connectable = false
        if let flag = advertisementData[CBAdvertisementDataIsConnectable] as? NSNumber {
            connectable = flag.boolValue
        }

        var localName: String? = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        if localName == nil {
            localName = peripheral.name
        }

        var txPowerLevel: Int32?
        if let level = advertisementData[CBAdvertisementDataTxPowerLevelKey] as? NSNumber {
            txPowerLevel = level.int32Value
        }

        let manufacturerData = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data

        var serviceData: [ServiceDataEntry] = []
        if let entries = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] {
            for (uuid, data) in entries {
                serviceData.append(ServiceDataEntry(uuid: nobleString(uuid), data: data))
            }
        }

        var serviceUuids: [String] = []
        if let uuids = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] {
            for uuid in uuids {
                serviceUuids.append(nobleString(uuid))
            }
        }

        js.discovered(
            Discovery(
                peripheralId: id,
                address: known.address,
                addressType: known.addressType,
                connectable: connectable,
                localName: localName,
                txPowerLevel: txPowerLevel,
                manufacturerData: manufacturerData,
                serviceData: serviceData,
                serviceUuids: serviceUuids,
                rssi: rssi))
    }

    // MARK: - Adapter state

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard !isShutDown else {
            return
        }
        let state = central.state
        let previous = lastState
        lastState = state

        if previous == .poweredOff && state == .poweredOn {
            // Links that survived the radio being switched off are stale: drop them.
            for session in sessions.values where session.peripheral.state == .connected {
                central.cancelPeripheralConnection(session.peripheral)
            }
        }

        if state != .poweredOn && state != previous {
            // CoreBluetooth forgets every outstanding operation without telling anybody.
            let message = "Bluetooth adapter is \(stateName(state))"
            for session in Array(sessions.values) {
                rejectAll(session, message)
                if !session.isConnected {
                    session.peripheral.delegate = nil
                    sessions.removeValue(forKey: session.id)
                }
            }
        }

        js.stateChanged(stateName(state))
    }

    // MARK: - Connecting

    func connect(requestId: UInt64, peripheralId: String) {
        onQueue {
            self.attempt(requestId) {
                let central = try self.poweredOnCentral()
                guard let identifier = parsePeripheralIdentifier(peripheralId) else {
                    throw RequestError("Invalid peripheral id '\(peripheralId)'")
                }
                let id = nobleString(identifier)

                let session: PeripheralSession
                if let existing = self.sessions[id],
                   existing.peripheral.state == .connected || existing.peripheral.state == .connecting {
                    session = existing
                } else {
                    if let stale = self.sessions[id] {
                        // Left behind by a link CoreBluetooth dropped without saying so.
                        self.rejectAll(stale, "Peripheral \(id) disconnected")
                        stale.peripheral.delegate = nil
                        self.sessions.removeValue(forKey: id)
                    }
                    let known = central.retrievePeripherals(withIdentifiers: [identifier])
                    guard let peripheral = known.first else {
                        throw RequestError("Peripheral \(id) is not known to CoreBluetooth")
                    }
                    peripheral.delegate = self
                    session = PeripheralSession(id: id, peripheral: peripheral)
                    self.sessions[id] = session
                }

                if session.isConnected && session.peripheral.state == .connected {
                    self.js.resolve(requestId)
                    return
                }
                session.isConnected = false
                session.pending.enqueue(requestId, for: .connect)
                let options: [String: Any] = [
                    CBConnectPeripheralOptionNotifyOnDisconnectionKey: NSNumber(value: true)
                ]
                central.connect(session.peripheral, options: options)
            }
        }
    }

    /// Abandons a connection attempt, or drops the link when it is already up.
    func cancelConnect(peripheralId: String) {
        onQueue {
            let id = normalizedPeripheralId(peripheralId)
            guard let session = self.sessions[id] else {
                return
            }
            if !session.isConnected {
                // Nothing guarantees a delegate callback for an attempt that
                // never produced a link, so the waiting connect() is answered here.
                self.rejectAll(session, "Connection to peripheral \(id) was cancelled")
                session.peripheral.delegate = nil
                self.sessions.removeValue(forKey: id)
            }
            if let central = self.central, central.state == .poweredOn {
                central.cancelPeripheralConnection(session.peripheral)
            }
        }
    }

    /// Completion is reported through `didDisconnectPeripheral`.
    func disconnect(peripheralId: String) {
        onQueue {
            let id = normalizedPeripheralId(peripheralId)
            guard let session = self.sessions[id] else {
                return
            }
            if let central = self.central, central.state == .poweredOn {
                central.cancelPeripheralConnection(session.peripheral)
            }
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard !isShutDown else {
            return
        }
        let id = nobleString(peripheral.identifier)
        guard let session = sessions[id], session.peripheral === peripheral else {
            // A connection nobody is waiting for any more (cancelled meanwhile).
            central.cancelPeripheralConnection(peripheral)
            return
        }

        if !discovered.contains(id) {
            // Connected by id without ever being scanned: JavaScript still
            // needs to learn about the peripheral, so report a bare sighting.
            reportDiscovery(peripheral, advertisementData: [:], rssi: 127)
        }

        session.isConnected = true
        let waiting = session.pending.dequeueAll(.connect)
        if waiting.isEmpty {
            js.connected(id)
        } else {
            for requestId in waiting {
                js.resolve(requestId)
            }
        }
        reportMTU(session)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard !isShutDown else {
            return
        }
        let id = nobleString(peripheral.identifier)
        guard let session = sessions[id], session.peripheral === peripheral else {
            return
        }
        sessions.removeValue(forKey: id)
        peripheral.delegate = nil
        rejectAll(session, error?.localizedDescription ?? "connection failed")
    }

    func centralManager(
        _ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?
    ) {
        guard !isShutDown else {
            return
        }
        let id = nobleString(peripheral.identifier)
        guard let session = sessions[id], session.peripheral === peripheral else {
            return
        }
        sessions.removeValue(forKey: id)
        peripheral.delegate = nil

        let wasConnected = session.isConnected
        session.isConnected = false

        var message = wasConnected ? "Peripheral \(id) disconnected" : "Connection to peripheral \(id) was cancelled"
        if let error = error {
            message = error.localizedDescription
        }
        rejectAll(session, message)

        if wasConnected {
            js.disconnected(id, reason: error?.localizedDescription ?? "unknown")
        }
    }

    // MARK: - RSSI

    func updateRSSI(requestId: UInt64, peripheralId: String) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                session.pending.enqueue(requestId, for: .readRSSI)
                session.peripheral.readRSSI()
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
        guard !isShutDown, let session = knownSession(for: peripheral) else {
            return
        }
        let rssi = RSSI.int32Value
        if let requestId = session.pending.dequeue(.readRSSI) {
            if let error = error {
                js.reject(requestId, error.localizedDescription)
            } else {
                js.resolve(requestId, number: rssi)
            }
        } else if error == nil {
            js.rssiUpdated(session.id, rssi: rssi)
        }
    }

    // MARK: - Services

    func discoverServices(requestId: UInt64, peripheralId: String, serviceUuids: [String]) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let filter = try self.parseFilter(serviceUuids)
                session.pending.enqueue(requestId, for: .discoverServices)
                session.peripheral.discoverServices(filter)
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard !isShutDown, let session = knownSession(for: peripheral) else {
            return
        }
        reportMTU(session)
        let services: [CBService] = peripheral.services ?? []
        let uuids = services.map { nobleString($0.uuid) }
        settle(session, .discoverServices, error: error) { requestId in
            js.resolve(requestId, strings: uuids)
        }
    }

    func discoverIncludedServices(
        requestId: UInt64, peripheralId: String, serviceUuid: String, serviceUuids: [String]
    ) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let service = try self.findService(session, serviceUuid)
                let filter = try self.parseFilter(serviceUuids)
                session.pending.enqueue(
                    requestId, for: .discoverIncludedServices(service: nobleString(service.uuid)))
                session.peripheral.discoverIncludedServices(filter, for: service)
            }
        }
    }

    func peripheral(
        _ peripheral: CBPeripheral, didDiscoverIncludedServicesFor service: CBService, error: Error?
    ) {
        guard !isShutDown, let session = knownSession(for: peripheral) else {
            return
        }
        let included: [CBService] = service.includedServices ?? []
        let uuids = included.map { nobleString($0.uuid) }
        let operation = PendingOperation.discoverIncludedServices(service: nobleString(service.uuid))
        settle(session, operation, error: error) { requestId in
            js.resolve(requestId, strings: uuids)
        }
    }

    // MARK: - Characteristics

    func discoverCharacteristics(
        requestId: UInt64, peripheralId: String, serviceUuid: String, characteristicUuids: [String]
    ) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let service = try self.findService(session, serviceUuid)
                let filter = try self.parseFilter(characteristicUuids)
                session.pending.enqueue(
                    requestId, for: .discoverCharacteristics(service: nobleString(service.uuid)))
                session.peripheral.discoverCharacteristics(filter, for: service)
            }
        }
    }

    func peripheral(
        _ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?
    ) {
        guard !isShutDown, let session = knownSession(for: peripheral) else {
            return
        }
        reportMTU(session)
        let characteristics: [CBCharacteristic] = service.characteristics ?? []
        let summaries = characteristics.map { characteristic in
            CharacteristicSummary(
                uuid: nobleString(characteristic.uuid),
                properties: UInt32(truncatingIfNeeded: characteristic.properties.rawValue))
        }
        let operation = PendingOperation.discoverCharacteristics(service: nobleString(service.uuid))
        settle(session, operation, error: error) { requestId in
            js.resolve(requestId, characteristics: summaries)
        }
    }

    func read(requestId: UInt64, peripheralId: String, serviceUuid: String, characteristicUuid: String) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let characteristic = try self.findCharacteristic(session, serviceUuid, characteristicUuid)
                session.pending.enqueue(requestId, for: PendingOperation.reading(characteristic))
                session.peripheral.readValue(for: characteristic)
            }
        }
    }

    /// Both the answer to a read and an incoming notification / indication end
    /// up here. A value that arrives while a read of the same characteristic is
    /// outstanding answers that read; anything else is a notification.
    func peripheral(
        _ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?
    ) {
        guard !isShutDown, let session = knownSession(for: peripheral) else {
            return
        }
        let data = characteristic.value ?? Data()
        let operation = PendingOperation.reading(characteristic)
        if let requestId = session.pending.dequeue(operation) {
            if let error = error {
                js.reject(requestId, error.localizedDescription)
            } else {
                js.resolve(requestId, data: data)
            }
        } else if error == nil {
            js.notification(
                session.id, service: serviceKey(of: characteristic),
                characteristic: nobleString(characteristic.uuid), data: data)
        }
    }

    func write(
        requestId: UInt64, peripheralId: String, serviceUuid: String, characteristicUuid: String,
        data: Data, withoutResponse: Bool
    ) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let characteristic = try self.findCharacteristic(session, serviceUuid, characteristicUuid)
                if withoutResponse {
                    // CoreBluetooth never confirms these: the write is done once it is handed over.
                    session.peripheral.writeValue(data, for: characteristic, type: .withoutResponse)
                    self.js.resolve(requestId)
                } else {
                    session.pending.enqueue(requestId, for: PendingOperation.writing(characteristic))
                    session.peripheral.writeValue(data, for: characteristic, type: .withResponse)
                }
            }
        }
    }

    func peripheral(
        _ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?
    ) {
        guard !isShutDown, let session = knownSession(for: peripheral) else {
            return
        }
        settle(session, PendingOperation.writing(characteristic), error: error) { requestId in
            js.resolve(requestId)
        }
    }

    func notify(
        requestId: UInt64, peripheralId: String, serviceUuid: String, characteristicUuid: String,
        enable: Bool
    ) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let characteristic = try self.findCharacteristic(session, serviceUuid, characteristicUuid)
                session.pending.enqueue(requestId, for: PendingOperation.settingNotify(characteristic))
                session.peripheral.setNotifyValue(enable, for: characteristic)
            }
        }
    }

    func peripheral(
        _ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
        error: Error?
    ) {
        guard !isShutDown, let session = knownSession(for: peripheral) else {
            return
        }
        settle(session, PendingOperation.settingNotify(characteristic), error: error) { requestId in
            js.resolve(requestId)
        }
    }

    // MARK: - Descriptors

    func discoverDescriptors(
        requestId: UInt64, peripheralId: String, serviceUuid: String, characteristicUuid: String
    ) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let characteristic = try self.findCharacteristic(session, serviceUuid, characteristicUuid)
                session.pending.enqueue(
                    requestId, for: PendingOperation.discoveringDescriptors(characteristic))
                session.peripheral.discoverDescriptors(for: characteristic)
            }
        }
    }

    func peripheral(
        _ peripheral: CBPeripheral, didDiscoverDescriptorsFor characteristic: CBCharacteristic, error: Error?
    ) {
        guard !isShutDown, let session = knownSession(for: peripheral) else {
            return
        }
        let descriptors: [CBDescriptor] = characteristic.descriptors ?? []
        let uuids = descriptors.map { nobleString($0.uuid) }
        settle(session, PendingOperation.discoveringDescriptors(characteristic), error: error) { requestId in
            js.resolve(requestId, strings: uuids)
        }
    }

    func readValue(
        requestId: UInt64, peripheralId: String, serviceUuid: String, characteristicUuid: String,
        descriptorUuid: String
    ) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let descriptor = try self.findDescriptor(
                    session, serviceUuid, characteristicUuid, descriptorUuid)
                session.pending.enqueue(requestId, for: PendingOperation.readingDescriptor(descriptor))
                session.peripheral.readValue(for: descriptor)
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor descriptor: CBDescriptor, error: Error?) {
        guard !isShutDown, let session = knownSession(for: peripheral) else {
            return
        }
        let data = descriptorBytes(descriptor.value)
        settle(session, PendingOperation.readingDescriptor(descriptor), error: error) { requestId in
            js.resolve(requestId, data: data)
        }
    }

    func writeValue(
        requestId: UInt64, peripheralId: String, serviceUuid: String, characteristicUuid: String,
        descriptorUuid: String, data: Data
    ) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let descriptor = try self.findDescriptor(
                    session, serviceUuid, characteristicUuid, descriptorUuid)
                try self.checkWritable(descriptor)
                session.pending.enqueue(requestId, for: PendingOperation.writingDescriptor(descriptor))
                session.peripheral.writeValue(data, for: descriptor)
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor descriptor: CBDescriptor, error: Error?) {
        guard !isShutDown, let session = knownSession(for: peripheral) else {
            return
        }
        settle(session, PendingOperation.writingDescriptor(descriptor), error: error) { requestId in
            js.resolve(requestId)
        }
    }

    // MARK: - Handles

    // CoreBluetooth has no raw ATT access. As before, handles are only
    // supported for descriptors that were already discovered; everything else
    // is rejected.

    func readHandle(requestId: UInt64, peripheralId: String, handle: Int) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let descriptor = try self.findDescriptor(session, handle: handle)
                session.pending.enqueue(requestId, for: PendingOperation.readingDescriptor(descriptor))
                session.peripheral.readValue(for: descriptor)
            }
        }
    }

    /// Descriptor writes are always acknowledged, so `withoutResponse` has no effect.
    func writeHandle(requestId: UInt64, peripheralId: String, handle: Int, data: Data, withoutResponse: Bool) {
        onQueue {
            self.attempt(requestId) {
                let session = try self.connectedSession(peripheralId)
                let descriptor = try self.findDescriptor(session, handle: handle)
                try self.checkWritable(descriptor)
                session.pending.enqueue(requestId, for: PendingOperation.writingDescriptor(descriptor))
                session.peripheral.writeValue(data, for: descriptor)
            }
        }
    }
}
