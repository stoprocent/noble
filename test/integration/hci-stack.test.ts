/**
 * End-to-end test of the HCI backend: the real Noble -> HciBindings -> Hci /
 * Gap / AclStream / Gatt stack, driven through the public API against a
 * simulated controller with one simulated peripheral behind it.
 *
 * The unit tests mock each layer's neighbours; this is what proves the layers
 * actually fit together.
 */

const mockSockets: any[] = [];

jest.mock('@stoprocent/bluetooth-hci-socket', () => {
  const ADAPTER_ADDRESS = Buffer.from('665544332211', 'hex'); // 11:22:33:44:55:66, little endian
  const PERIPHERAL_ADDRESS = Buffer.from('0f0e0d0c0b0a', 'hex'); // 0a:0b:0c:0d:0e:0f
  const CONNECTION_HANDLE = 0x0040;

  class MockSocket {
    listeners: Record<string, (arg?: any) => void> = {};
    commands: number[] = [];
    notifyAfterSubscribe = true;

    constructor () {
      mockSockets.push(this);
    }

    on (event: string, listener: (arg?: any) => void): this {
      this.listeners[event] = listener;
      return this;
    }

    removeAllListeners (): void { this.listeners = {}; }
    bindRaw (): number { return 0; }
    bindUser (): number { return 0; }
    start (): void {}
    stop (): void {}
    setFilter (): void {}
    isDevUp (): boolean { return true; }

    write (packet: Buffer): void {
      // A controller never answers from inside the write call.
      setImmediate(() => {
        if (packet[0] === 0x01) {
          this.onCommand(packet.readUInt16LE(1), packet.slice(4));
        } else if (packet[0] === 0x02) {
          this.onAcl(packet);
        }
      });
    }

    receive (packet: Buffer): void {
      this.listeners.data?.(packet);
    }

    commandComplete (opcode: number, result: Buffer = Buffer.alloc(8)): void {
      const header = Buffer.from([0x04, 0x0e, 4 + result.length, 0x01, opcode & 0xff, opcode >> 8, 0x00]);
      this.receive(Buffer.concat([header, result]));
    }

    onCommand (opcode: number, params: Buffer): void {
      this.commands.push(opcode);
      switch (opcode) {
        case 0x1001: // Read Local Version: HCI version 9 (Bluetooth 5.0)
          return this.commandComplete(opcode, Buffer.from([0x09, 0, 0, 0x09, 0x0f, 0x00, 0, 0]));
        case 0x1009: // Read BD_ADDR
          return this.commandComplete(opcode, ADAPTER_ADDRESS);
        case 0x2002: // LE Read Buffer Size: 251 octets, 8 packets
          return this.commandComplete(opcode, Buffer.from([0xfb, 0x00, 0x08]));
        case 0x200c: // LE Set Scan Enable
          this.commandComplete(opcode);
          if (params[0] === 0x01) {
            // Two connectable advertisements: noble reports after the second.
            this.advertise();
            this.advertise();
          }
          return;
        case 0x200d: // LE Create Connection -> Command Status, then LE Connection Complete
          this.receive(Buffer.from([0x04, 0x0f, 0x04, 0x00, 0x01, 0x0d, 0x20]));
          return this.receive(Buffer.concat([
            Buffer.from([0x04, 0x3e, 0x13, 0x01, 0x00, CONNECTION_HANDLE, 0x00, 0x00, 0x00]),
            PERIPHERAL_ADDRESS,
            Buffer.from([0x06, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x00])
          ]));
        case 0x0406: // Disconnect -> Disconnection Complete, reason: local host terminated
          this.receive(Buffer.from([0x04, 0x0f, 0x04, 0x00, 0x01, 0x06, 0x04]));
          return this.receive(Buffer.from([0x04, 0x05, 0x04, 0x00, params[0], params[1], 0x16]));
        case 0x1405: // Read RSSI: -42 dBm
          return this.commandComplete(opcode, Buffer.from([params[0], params[1], 0xd6]));
        default:
          return this.commandComplete(opcode);
      }
    }

    advertise (): void {
      const eir = Buffer.from([0x04, 0x09, 0x73, 0x69, 0x6d, 0x03, 0x03, 0x0f, 0x18]); // name "sim", service 180f
      this.receive(Buffer.concat([
        Buffer.from([0x04, 0x3e, 12 + eir.length, 0x02, 0x01, 0x00, 0x00]),
        PERIPHERAL_ADDRESS,
        Buffer.from([eir.length]),
        eir,
        Buffer.from([0xc4]) // rssi -60
      ]));
    }

    onAcl (packet: Buffer): void {
      const handle = packet.readUInt16LE(1) & 0x0fff;
      // Number Of Completed Packets: frees the controller buffer.
      this.receive(Buffer.from([0x04, 0x13, 0x05, 0x01, handle & 0xff, handle >> 8, 0x01, 0x00]));

      if (packet.readUInt16LE(7) === 0x0004) {
        const response = this.onAtt(packet.slice(9));
        if (response) {
          this.sendAtt(response);
        }
      }
    }

    sendAtt (pdu: Buffer): void {
      const header = Buffer.alloc(9);
      header.writeUInt8(0x02, 0);
      header.writeUInt16LE(CONNECTION_HANDLE | (0x02 << 12), 1);
      header.writeUInt16LE(pdu.length + 4, 3);
      header.writeUInt16LE(pdu.length, 5);
      header.writeUInt16LE(0x0004, 7);
      this.receive(Buffer.concat([header, pdu]));
    }

    /**
     * GATT database of the simulated peripheral:
     *   0x0001-0x0005  Battery Service (180f)
     *   0x0002         characteristic declaration: 2a19, read | notify, value at 0x0003
     *   0x0004         client characteristic configuration (2902)
     *   0x0005         characteristic user description (2901)
     */
    onAtt (pdu: Buffer): Buffer | null {
      const notFound = (handle: number): Buffer => Buffer.from([0x01, pdu[0], handle & 0xff, handle >> 8, 0x0a]);

      switch (pdu[0]) {
        case 0x02: // Exchange MTU
          return Buffer.from([0x03, 0x40, 0x00]);
        case 0x10: { // Read By Group Type (primary services)
          const start = pdu.readUInt16LE(1);
          return start === 1 ? Buffer.from([0x11, 0x06, 0x01, 0x00, 0x05, 0x00, 0x0f, 0x18]) : notFound(start);
        }
        case 0x08: { // Read By Type
          const start = pdu.readUInt16LE(1);
          const type = pdu.readUInt16LE(5);
          if (type === 0x2803 && start <= 2) {
            return Buffer.from([0x09, 0x07, 0x02, 0x00, 0x12, 0x03, 0x00, 0x19, 0x2a]);
          }
          if (type === 0x2902) {
            return Buffer.from([0x09, 0x04, 0x04, 0x00, 0x00, 0x00]);
          }
          return notFound(start);
        }
        case 0x04: { // Find Information (descriptors)
          const start = pdu.readUInt16LE(1);
          return start === 4
            ? Buffer.from([0x05, 0x01, 0x04, 0x00, 0x02, 0x29, 0x05, 0x00, 0x01, 0x29])
            : notFound(start);
        }
        case 0x0a: { // Read
          const handle = pdu.readUInt16LE(1);
          if (handle === 3) return Buffer.from([0x0b, 0x64]);
          if (handle === 5) return Buffer.concat([Buffer.from([0x0b]), Buffer.from('level')]);
          return Buffer.from([0x01, 0x0a, handle & 0xff, handle >> 8, 0x02]); // read not permitted
        }
        case 0x12: { // Write Request
          const subscribing = pdu.readUInt16LE(1) === 4 && pdu[3] === 0x01;
          if (subscribing && this.notifyAfterSubscribe) {
            setImmediate(() => {
              this.sendAtt(Buffer.from([0x1b, 0x03, 0x00, 0x63]));
              this.sendAtt(Buffer.from([0x1b, 0x03, 0x00, 0x62]));
            });
          }
          return Buffer.from([0x13]);
        }
        default:
          return null;
      }
    }
  }

  return { loadDriver: () => MockSocket };
});

import { HciBindings } from '../../src/bindings/hci/bindings';
import { AttError } from '../../src/bindings/hci/gatt';
import { DisconnectedError, Noble, type Peripheral } from '../../src';

describe('HCI stack end to end', () => {
  let noble: Noble;
  let warnings: string[];

  beforeEach(() => {
    mockSockets.length = 0;
    noble = new Noble(new HciBindings({}));
    warnings = [];
    noble.onWarning(message => warnings.push(message));
  });

  afterEach(() => {
    noble.stop();
    if (warnings.length > 0) {
      throw new Error(`unexpected warnings: ${warnings.join('; ')}`);
    }
  });

  async function discoverSim (): Promise<Peripheral> {
    await noble.waitForPoweredOn(1000);
    for await (const peripheral of noble.discover()) {
      return peripheral;
    }
    throw new Error('discover() ended without yielding');
  }

  test('powers on and reports the adapter address', async () => {
    await noble.waitForPoweredOn(1000);

    expect(noble.state).toBe('poweredOn');
    expect(noble.address).toBe('11:22:33:44:55:66');
  });

  test('discovers a peripheral and stops scanning when the loop is left', async () => {
    const scanStops: number[] = [];
    noble.onScanStop(() => scanStops.push(Date.now()));

    const peripheral = await discoverSim();

    expect(peripheral.id).toBe('0a0b0c0d0e0f');
    expect(peripheral.address).toBe('0a:0b:0c:0d:0e:0f');
    expect(peripheral.addressType).toBe('public');
    expect(peripheral.connectable).toBe(true);
    expect(peripheral.rssi).toBe(-60);
    expect(peripheral.advertisement.localName).toBe('sim');
    expect(peripheral.advertisement.serviceUuids).toEqual(['180f']);
    expect(scanStops.length).toBeGreaterThan(0);
  });

  test('connects, explores, reads, streams notifications and disconnects', async () => {
    const peripheral = await discoverSim();
    const disconnects: unknown[] = [];
    const mtus: number[] = [];
    peripheral.onDisconnect(reason => disconnects.push(reason));
    peripheral.onMtuChange(mtu => mtus.push(mtu));

    await peripheral.connect();
    expect(peripheral.state).toBe('connected');

    const { services, characteristics } = await peripheral.discoverAllServicesAndCharacteristics();
    expect(services.map(service => [service.uuid, service.name])).toEqual([['180f', 'Battery Service']]);
    expect(characteristics.map(characteristic => [characteristic.uuid, characteristic.properties]))
      .toEqual([['2a19', ['read', 'notify']]]);
    expect(services[0].characteristics).toEqual(characteristics);
    // The MTU exchange was queued ahead of discovery, so it has completed by now.
    expect(mtus).toEqual([64]);
    expect(peripheral.mtu).toBe(64);

    const [batteryLevel] = characteristics;
    expect(await batteryLevel.read()).toEqual(Buffer.from([0x64]));

    const descriptors = await batteryLevel.discoverDescriptors();
    expect(descriptors.map(descriptor => descriptor.uuid)).toEqual(['2902', '2901']);
    expect((await descriptors[1].readValue()).toString()).toBe('level');

    const notified: number[] = [];
    for await (const data of batteryLevel.notifications()) {
      notified.push(data[0]);
      if (notified.length === 2) break;
    }
    expect(notified).toEqual([0x63, 0x62]);
    expect(batteryLevel.isNotifying).toBe(false);

    expect(await peripheral.updateRssi()).toBe(-42);
    expect(await peripheral.readHandle(3)).toEqual(Buffer.from([0x64]));
    await peripheral.writeHandle(3, Buffer.from([0x01]));
    await batteryLevel.write(Buffer.from([0x01]), true);

    await peripheral.disconnect();
    expect(peripheral.state).toBe('disconnected');
    expect(disconnects).toEqual([0x16]);
  });

  test('an ATT error response rejects the read', async () => {
    const peripheral = await discoverSim();
    await peripheral.connect();

    await expect(peripheral.readHandle(0x0099)).rejects.toBeInstanceOf(AttError);

    await peripheral.disconnect();
  });

  test('connects by address without scanning', async () => {
    await noble.waitForPoweredOn(1000);

    const peripheral = await noble.connect('0a:0b:0c:0d:0e:0f', { addressType: 'public' });

    expect(peripheral.id).toBe('0a0b0c0d0e0f');
    expect(peripheral.state).toBe('connected');
    expect(await peripheral.discoverServices()).toHaveLength(1);

    await peripheral.disconnect();
  });

  test('a link lost mid-operation rejects it with DisconnectedError', async () => {
    const peripheral = await discoverSim();
    await peripheral.connect();
    const [service] = await peripheral.discoverServices();
    const [characteristic] = await service.discoverCharacteristics();

    // The peripheral falls silent, then the controller reports a supervision timeout.
    const socket = mockSockets[0];
    socket.onAtt = () => null;
    const read = characteristic.read();
    setImmediate(() => socket.receive(Buffer.from([0x04, 0x05, 0x04, 0x00, 0x40, 0x00, 0x08])));

    await expect(read).rejects.toMatchObject({ reason: 0x08 });
    await expect(read).rejects.toBeInstanceOf(DisconnectedError);
    expect(peripheral.state).toBe('disconnected');
  });
});
