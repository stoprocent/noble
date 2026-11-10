import createDebug from 'debug';

import { Deferred } from '../../common/deferred';
import { NobleError } from '../../common/errors';
import type { CharacteristicProperty } from '../../types';
import type { AclStream } from './acl-stream';
import type { GattCharacteristic, GattDelegate } from './types';

const debug = createDebug('att');

const ATT_OP_ERROR = 0x01;
const ATT_OP_MTU_REQ = 0x02;
const ATT_OP_MTU_RESP = 0x03;
const ATT_OP_FIND_INFO_REQ = 0x04;
const ATT_OP_FIND_INFO_RESP = 0x05;
const ATT_OP_READ_BY_TYPE_REQ = 0x08;
const ATT_OP_READ_BY_TYPE_RESP = 0x09;
const ATT_OP_READ_REQ = 0x0a;
const ATT_OP_READ_RESP = 0x0b;
const ATT_OP_READ_BLOB_REQ = 0x0c;
const ATT_OP_READ_BLOB_RESP = 0x0d;
const ATT_OP_READ_BY_GROUP_REQ = 0x10;
const ATT_OP_READ_BY_GROUP_RESP = 0x11;
const ATT_OP_WRITE_REQ = 0x12;
const ATT_OP_WRITE_RESP = 0x13;
const ATT_OP_PREPARE_WRITE_REQ = 0x16;
const ATT_OP_PREPARE_WRITE_RESP = 0x17;
const ATT_OP_EXECUTE_WRITE_REQ = 0x18;
const ATT_OP_EXECUTE_WRITE_RESP = 0x19;
const ATT_OP_HANDLE_NOTIFY = 0x1b;
const ATT_OP_HANDLE_IND = 0x1d;
const ATT_OP_HANDLE_CNF = 0x1e;
const ATT_OP_WRITE_CMD = 0x52;

const ATT_ECODE_INVALID_PDU = 0x04;
const ATT_ECODE_AUTHENTICATION = 0x05;
const ATT_ECODE_REQ_NOT_SUPP = 0x06;
const ATT_ECODE_AUTHORIZATION = 0x08;
const ATT_ECODE_INSUFF_ENC = 0x0f;

const ATT_ECODE_NAMES: Readonly<Record<number, string>> = {
  0x01: 'Invalid Handle',
  0x02: 'Read Not Permitted',
  0x03: 'Write Not Permitted',
  0x04: 'Invalid PDU',
  0x05: 'Insufficient Authentication',
  0x06: 'Request Not Supported',
  0x07: 'Invalid Offset',
  0x08: 'Insufficient Authorization',
  0x09: 'Prepare Queue Full',
  0x0a: 'Attribute Not Found',
  0x0b: 'Attribute Not Long',
  0x0c: 'Insufficient Encryption Key Size',
  0x0d: 'Invalid Attribute Value Length',
  0x0e: 'Unlikely Error',
  0x0f: 'Insufficient Encryption',
  0x10: 'Unsupported Group Type',
  0x11: 'Insufficient Resources'
};

const GATT_PRIM_SVC_UUID = 0x2800;
const GATT_INCLUDE_UUID = 0x2802;
const GATT_CHARAC_UUID = 0x2803;

const GATT_CLIENT_CHARAC_CFG_UUID = 0x2902;
const GATT_SERVER_CHARAC_CFG_UUID = 0x2903;

const ATT_CID = 0x0004;

// Core Spec Vol 3 Part F 3.2.8: ATT_MTU ranges from the 23 octet default to 517.
const ATT_MIN_MTU = 23;
const ATT_MAX_MTU = 517;
const ATT_DEFAULT_REQUEST_MTU = 256;

const CHARACTERISTIC_PROPERTIES: ReadonlyArray<readonly [number, CharacteristicProperty]> = [
  [0x01, 'broadcast'],
  [0x02, 'read'],
  [0x04, 'writeWithoutResponse'],
  [0x08, 'write'],
  [0x10, 'notify'],
  [0x20, 'indicate'],
  [0x40, 'authenticatedSignedWrites'],
  [0x80, 'extendedProperties']
];

const hex = (value: number, width: number): string => `0x${value.toString(16).padStart(width, '0')}`;

/**
 * The client RX MTU to put into the exchange. The value comes from the
 * caller's connect options and ends up in a 16-bit field of the request, so
 * anything that is not an integer in the ATT range is replaced by the default
 * here, once, instead of throwing (or going out) on the connect path.
 */
function requestableMtu (desiredMtu: unknown): number {
  if (desiredMtu === undefined || desiredMtu === null) {
    return ATT_DEFAULT_REQUEST_MTU;
  }

  if (typeof desiredMtu !== 'number' || !Number.isInteger(desiredMtu) || desiredMtu < ATT_MIN_MTU || desiredMtu > ATT_MAX_MTU) {
    debug(`ignoring unusable desired mtu ${String(desiredMtu)}, requesting ${ATT_DEFAULT_REQUEST_MTU}`);
    return ATT_DEFAULT_REQUEST_MTU;
  }

  return desiredMtu;
}

/** The peer answered a request with an ATT Error Response. */
export class AttError extends NobleError {
  /** Opcode of the request that failed. */
  readonly opcode: number;
  /** Attribute handle the error refers to. */
  readonly handle: number;
  /** ATT error code. */
  readonly code: number;

  /** @param pdu the complete ATT Error Response PDU */
  constructor (pdu: Buffer) {
    const opcode = pdu.length > 1 ? pdu.readUInt8(1) : 0;
    const handle = pdu.length > 3 ? pdu.readUInt16LE(2) : 0;
    const code = pdu.length > 4 ? pdu.readUInt8(4) : 0;
    const name = ATT_ECODE_NAMES[code];

    super(`ATT error ${hex(code, 2)}${name ? ` (${name})` : ''} in response to request ${hex(opcode, 2)} on handle ${hex(handle, 4)}`);

    this.opcode = opcode;
    this.handle = handle;
    this.code = code;
  }
}

interface ServiceEntry {
  uuid: string;
  startHandle: number;
  endHandle: number;
}

interface IncludedServiceEntry {
  uuid: string;
  startHandle: number;
  endHandle: number;
}

interface CharacteristicEntry {
  uuid: string;
  startHandle: number;
  /** Raw properties bit field. */
  properties: number;
  valueHandle: number;
  endHandle: number;
}

interface DescriptorEntry {
  uuid: string;
  handle: number;
}

interface Command {
  buffer: Buffer;
  /** Present on requests: settled with the peer's response PDU. */
  response?: Deferred<Buffer>;
  /** Present on commands without a response: settled once written. */
  written?: Deferred<void>;
}

/** GATT client over the ATT channel of one connection. */
export class Gatt {
  private readonly services = new Map<string, ServiceEntry>();
  private readonly characteristics = new Map<string, Map<string, CharacteristicEntry>>();
  private readonly descriptors = new Map<string, Map<string, Map<string, DescriptorEntry>>>();

  private currentCommand: Command | null = null;
  private commandQueue: Command[] = [];

  private currentMtu = ATT_MIN_MTU;
  private readonly desiredMtu: number;
  private security: 'low' | 'medium' = 'low';
  private encrypting = false;
  private closeError: Error | null = null;

  constructor (
    private readonly address: string,
    private readonly aclStream: AclStream,
    private readonly delegate: GattDelegate,
    desiredMtu?: number
  ) {
    this.desiredMtu = requestableMtu(desiredMtu);

    this.aclStream.registerChannel(ATT_CID, (data) => this.onAclStreamData(data));
  }

  get mtu (): number {
    return this.currentMtu;
  }

  /** The link is gone: fails the in-flight command and everything queued behind it. */
  close (error: Error): void {
    if (this.closeError !== null) {
      return;
    }

    this.closeError = error;

    const commands = this.commandQueue;
    const current = this.currentCommand;

    this.commandQueue = [];
    this.currentCommand = null;

    if (current !== null) {
      commands.unshift(current);
    }

    for (const command of commands) {
      command.response?.reject(error);
      command.written?.reject(error);
    }
  }

  async exchangeMtu (): Promise<number> {
    const data = await this.request(this.mtuRequest(this.desiredMtu));
    const opcode = data[0];

    if (opcode === ATT_OP_MTU_RESP) {
      // Core Spec Vol 3 Part F 3.4.2.2: the response carries the peer's own RX MTU,
      // so ATT_MTU is the smaller of the two.
      const newMtu = Math.min(this.desiredMtu, data.readUInt16LE(1));

      debug(`${this.address}: new MTU is ${newMtu}`);

      this.currentMtu = newMtu;
    }

    return this.currentMtu;
  }

  async discoverServices (uuids: string[]): Promise<string[]> {
    const services: ServiceEntry[] = [];
    let startHandle = 0x0001;

    for (;;) {
      const data = await this.request(this.readByGroupRequest(startHandle, 0xffff, GATT_PRIM_SVC_UUID));
      const opcode = data[0];

      if (opcode === ATT_OP_READ_BY_GROUP_RESP) {
        const type = data[1];
        const num = (data.length - 2) / type;

        for (let i = 0; i < num; i++) {
          const offset = 2 + i * type;
          services.push({
            startHandle: data.readUInt16LE(offset),
            endHandle: data.readUInt16LE(offset + 2),
            uuid: (type === 6) ? data.readUInt16LE(offset + 4).toString(16) : uuid128(data, offset + 4)
          });
        }
      }

      if (opcode !== ATT_OP_READ_BY_GROUP_RESP || services.length === 0 || services[services.length - 1].endHandle === 0xffff) {
        break;
      }

      startHandle = services[services.length - 1].endHandle + 1;
    }

    const serviceUuids: string[] = [];

    for (const service of services) {
      const uuid = service.uuid.trim();
      if ((uuids.length === 0 || uuids.indexOf(uuid) !== -1) && serviceUuids.indexOf(uuid) === -1) {
        serviceUuids.push(uuid);
      }

      this.services.set(service.uuid, service);
    }

    return serviceUuids;
  }

  async discoverIncludedServices (serviceUuid: string, uuids: string[]): Promise<string[]> {
    const service = this.getService(serviceUuid);
    const includedServices: IncludedServiceEntry[] = [];
    let startHandle = service.startHandle;

    for (;;) {
      const data = await this.request(this.readByTypeRequest(startHandle, service.endHandle, GATT_INCLUDE_UUID));
      const opcode = data[0];

      if (opcode === ATT_OP_READ_BY_TYPE_RESP) {
        const type = data[1];
        const num = (data.length - 2) / type;

        for (let i = 0; i < num; i++) {
          const offset = 2 + i * type;
          includedServices.push({
            endHandle: data.readUInt16LE(offset),
            startHandle: data.readUInt16LE(offset + 2),
            uuid: (type === 8) ? data.readUInt16LE(offset + 6).toString(16) : uuid128(data, offset + 6)
          });
        }
      }

      if (opcode !== ATT_OP_READ_BY_TYPE_RESP || includedServices.length === 0 || includedServices[includedServices.length - 1].endHandle === service.endHandle) {
        break;
      }

      startHandle = includedServices[includedServices.length - 1].endHandle + 1;
    }

    const includedServiceUuids: string[] = [];

    for (const includedService of includedServices) {
      if (uuids.length === 0 || uuids.indexOf(includedService.uuid) !== -1) {
        includedServiceUuids.push(includedService.uuid);
      }
    }

    return includedServiceUuids;
  }

  async discoverCharacteristics (serviceUuid: string, characteristicUuids: string[]): Promise<GattCharacteristic[]> {
    const service = this.getService(serviceUuid);
    const characteristics: CharacteristicEntry[] = [];
    let startHandle = service.startHandle;

    let serviceCharacteristics = this.characteristics.get(serviceUuid);
    if (serviceCharacteristics === undefined) {
      serviceCharacteristics = new Map();
      this.characteristics.set(serviceUuid, serviceCharacteristics);
    }
    if (!this.descriptors.has(serviceUuid)) {
      this.descriptors.set(serviceUuid, new Map());
    }

    for (;;) {
      const data = await this.request(this.readByTypeRequest(startHandle, service.endHandle, GATT_CHARAC_UUID));
      const opcode = data[0];

      if (opcode === ATT_OP_READ_BY_TYPE_RESP) {
        const type = data[1];
        const num = (data.length - 2) / type;

        for (let i = 0; i < num; i++) {
          const offset = 2 + i * type;
          characteristics.push({
            startHandle: data.readUInt16LE(offset),
            properties: data.readUInt8(offset + 2),
            valueHandle: data.readUInt16LE(offset + 3),
            uuid: (type === 7) ? data.readUInt16LE(offset + 5).toString(16) : uuid128(data, offset + 5),
            // the real end is only known once the next characteristic (or the end of the service) is
            endHandle: service.endHandle
          });
        }
      }

      if (opcode !== ATT_OP_READ_BY_TYPE_RESP || characteristics.length === 0 || characteristics[characteristics.length - 1].valueHandle === service.endHandle) {
        break;
      }

      startHandle = characteristics[characteristics.length - 1].valueHandle + 1;
    }

    const characteristicsDiscovered: GattCharacteristic[] = [];

    for (let i = 0; i < characteristics.length; i++) {
      const properties = characteristics[i].properties;

      const characteristic: GattCharacteristic = {
        properties: [],
        uuid: characteristics[i].uuid
      };

      if (i !== 0) {
        characteristics[i - 1].endHandle = characteristics[i].startHandle - 1;
      }

      if (i === (characteristics.length - 1)) {
        characteristics[i].endHandle = service.endHandle;
      }

      serviceCharacteristics.set(characteristics[i].uuid, characteristics[i]);

      for (const [mask, property] of CHARACTERISTIC_PROPERTIES) {
        if (properties & mask) {
          characteristic.properties.push(property);
        }
      }

      if (characteristicUuids.length === 0 || characteristicUuids.indexOf(characteristic.uuid) !== -1) {
        characteristicsDiscovered.push(characteristic);
      }
    }

    return characteristicsDiscovered;
  }

  async read (serviceUuid: string, characteristicUuid: string): Promise<Buffer> {
    const characteristic = this.getCharacteristic(serviceUuid, characteristicUuid);

    return this.readAttribute(characteristic.valueHandle);
  }

  async write (serviceUuid: string, characteristicUuid: string, data: Buffer, withoutResponse: boolean): Promise<void> {
    const characteristic = this.getCharacteristic(serviceUuid, characteristicUuid);

    if (withoutResponse) {
      await this.send(this.writeRequest(characteristic.valueHandle, data, true));
    } else if (data.length + 3 > this.currentMtu) {
      await this.longWrite(characteristic.valueHandle, data);
    } else {
      const response = await this.request(this.writeRequest(characteristic.valueHandle, data, false));

      this.expectResponse(response, ATT_OP_WRITE_RESP, 'ATT_OP_WRITE_RESP');
    }
  }

  async broadcast (serviceUuid: string, characteristicUuid: string, broadcast: boolean): Promise<void> {
    const characteristic = this.getCharacteristic(serviceUuid, characteristicUuid);

    const data = await this.request(this.readByTypeRequest(characteristic.startHandle, characteristic.endHandle, GATT_SERVER_CHARAC_CFG_UUID));

    this.expectResponse(data, ATT_OP_READ_BY_TYPE_RESP, 'ATT_OP_READ_BY_TYPE_RESP');

    const handle = data.readUInt16LE(2);
    let value = data.readUInt16LE(4);

    if (broadcast) {
      value |= 0x0001;
    } else {
      value &= 0xfffe;
    }

    const valueBuffer = Buffer.alloc(2);
    valueBuffer.writeUInt16LE(value, 0);

    const response = await this.request(this.writeRequest(handle, valueBuffer, false));

    this.expectResponse(response, ATT_OP_WRITE_RESP, 'ATT_OP_WRITE_RESP');
  }

  async notify (serviceUuid: string, characteristicUuid: string, notify: boolean): Promise<void> {
    const characteristic = this.getCharacteristic(serviceUuid, characteristicUuid);

    const data = await this.request(this.readByTypeRequest(characteristic.startHandle, characteristic.endHandle, GATT_CLIENT_CHARAC_CFG_UUID));

    this.expectResponse(data, ATT_OP_READ_BY_TYPE_RESP, 'ATT_OP_READ_BY_TYPE_RESP');

    const handle = data.readUInt16LE(2);
    let value = data.readUInt16LE(4);

    const useNotify = characteristic.properties & 0x10;
    const useIndicate = characteristic.properties & 0x20;

    if (notify) {
      if (useNotify) {
        value |= 0x0001;
      } else if (useIndicate) {
        value |= 0x0002;
      }
    } else {
      if (useNotify) {
        value &= 0xfffe;
      } else if (useIndicate) {
        value &= 0xfffd;
      }
    }

    const valueBuffer = Buffer.alloc(2);
    valueBuffer.writeUInt16LE(value, 0);

    const response = await this.request(this.writeRequest(handle, valueBuffer, false));

    this.expectResponse(response, ATT_OP_WRITE_RESP, 'ATT_OP_WRITE_RESP');
  }

  async discoverDescriptors (serviceUuid: string, characteristicUuid: string): Promise<string[]> {
    const characteristic = this.getCharacteristic(serviceUuid, characteristicUuid);
    const descriptors: DescriptorEntry[] = [];
    let startHandle = characteristic.valueHandle + 1;

    let serviceDescriptors = this.descriptors.get(serviceUuid);
    if (serviceDescriptors === undefined) {
      serviceDescriptors = new Map();
      this.descriptors.set(serviceUuid, serviceDescriptors);
    }

    const characteristicDescriptors = new Map<string, DescriptorEntry>();
    serviceDescriptors.set(characteristicUuid, characteristicDescriptors);

    for (;;) {
      const data = await this.request(this.findInfoRequest(startHandle, characteristic.endHandle));
      const opcode = data[0];

      if (opcode === ATT_OP_FIND_INFO_RESP) {
        const format = data[1];
        const elen = 2 + (format === 0x01 ? 2 : 16);
        const num = (data.length - 2) / (elen);
        for (let i = 0; i < num; i++) {
          const offset = 2 + (i * elen);
          descriptors.push({
            handle: data.readUInt16LE(offset + 0),
            uuid: (format === 0x01) ? data.readUInt16LE(offset + 2).toString(16) : uuid128(data, offset + 2)
          });
        }
      }

      if (opcode !== ATT_OP_FIND_INFO_RESP || descriptors.length === 0 || descriptors[descriptors.length - 1].handle === characteristic.endHandle) {
        break;
      }

      startHandle = descriptors[descriptors.length - 1].handle + 1;
    }

    const descriptorUuids: string[] = [];

    for (const descriptor of descriptors) {
      descriptorUuids.push(descriptor.uuid);

      characteristicDescriptors.set(descriptor.uuid, descriptor);
    }

    return descriptorUuids;
  }

  async readValue (serviceUuid: string, characteristicUuid: string, descriptorUuid: string): Promise<Buffer> {
    const descriptor = this.getDescriptor(serviceUuid, characteristicUuid, descriptorUuid);

    return this.readAttribute(descriptor.handle);
  }

  async writeValue (serviceUuid: string, characteristicUuid: string, descriptorUuid: string, data: Buffer): Promise<void> {
    const descriptor = this.getDescriptor(serviceUuid, characteristicUuid, descriptorUuid);

    const response = await this.request(this.writeRequest(descriptor.handle, data, false));

    this.expectResponse(response, ATT_OP_WRITE_RESP, 'ATT_OP_WRITE_RESP');
  }

  async readHandle (handle: number): Promise<Buffer> {
    return this.readAttribute(handle);
  }

  async writeHandle (handle: number, data: Buffer, withoutResponse: boolean): Promise<void> {
    if (withoutResponse) {
      await this.send(this.writeRequest(handle, data, true));
    } else {
      const response = await this.request(this.writeRequest(handle, data, false));

      this.expectResponse(response, ATT_OP_WRITE_RESP, 'ATT_OP_WRITE_RESP');
    }
  }

  /** Read, continued with Read Blob requests for as long as the peer fills the MTU. */
  private async readAttribute (handle: number): Promise<Buffer> {
    let readData = Buffer.alloc(0);
    let data = await this.request(this.readRequest(handle));

    if (data[0] === ATT_OP_ERROR) {
      throw new AttError(data);
    }

    for (;;) {
      const opcode = data[0];

      if (opcode !== ATT_OP_READ_RESP && opcode !== ATT_OP_READ_BLOB_RESP) {
        // an error on a later blob just ends the read with what we have so far
        return readData;
      }

      readData = Buffer.concat([readData, data.slice(1)]);

      if (data.length !== this.currentMtu) {
        return readData;
      }

      data = await this.request(this.readBlobRequest(handle, readData.length));
    }
  }

  /* Perform a "long write" as described Bluetooth Spec section 4.9.4 "Write Long Characteristic Values" */
  private async longWrite (handle: number, data: Buffer): Promise<void> {
    const limit = this.currentMtu - 5;
    const prepares: Array<{ chunk: Buffer; response: Promise<Buffer> }> = [];

    /* split into prepare-write chunks and queue them */
    let offset = 0;

    while (offset < data.length) {
      const end = offset + limit;
      const chunk = data.slice(offset, end);
      prepares.push({ chunk, response: this.request(this.prepareWriteRequest(handle, offset, chunk)) });
      offset = end;
    }

    /* queue the execute command right behind them, so nothing can slip in between */
    const execute = this.request(this.executeWriteRequest(handle));

    // Everything is already on the queue (and goes out whatever the peer
    // answers); now collect the outcomes and report the first failure.
    const outcomes = await Promise.allSettled([...prepares.map(({ response }) => response), execute]);
    let failure: Error | null = null;

    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === 'rejected') {
        failure = failure ?? (outcome.reason instanceof Error ? outcome.reason : new NobleError(String(outcome.reason)));
        continue;
      }

      const resp = outcome.value;

      try {
        if (index === prepares.length) {
          this.expectResponse(resp, ATT_OP_EXECUTE_WRITE_RESP, 'ATT_OP_EXECUTE_WRITE_RESP');
          continue;
        }

        this.expectResponse(resp, ATT_OP_PREPARE_WRITE_RESP, 'ATT_OP_PREPARE_WRITE_RESP');
      } catch (error) {
        failure = failure ?? (error as Error);
        continue;
      }

      const expectedLength = prepares[index].chunk.length + 5;

      if (resp.length !== expectedLength) {
        /* the response should contain the data packet echoed back to the caller */
        debug(`${this.address}: unexpected prepareWriteResponse length %d (expecting %d)`, resp.length, expectedLength);
      }
    }

    if (failure !== null) {
      throw failure;
    }
  }

  private expectResponse (data: Buffer, expectedOpcode: number, expectedName: string): void {
    const opcode = data[0];

    if (opcode === expectedOpcode) {
      return;
    }

    if (opcode === ATT_OP_ERROR) {
      throw new AttError(data);
    }

    debug(`${this.address}: unexpected reply opcode %d (expecting ${expectedName})`, opcode);

    throw new NobleError(`Unexpected ATT response opcode ${hex(opcode, 2)} (expecting ${expectedName})`);
  }

  private getService (serviceUuid: string): ServiceEntry {
    const service = this.services.get(serviceUuid);

    if (service === undefined) {
      throw new NobleError(`Unknown service ${serviceUuid}: it has not been discovered on ${this.address}`);
    }

    return service;
  }

  private getCharacteristic (serviceUuid: string, characteristicUuid: string): CharacteristicEntry {
    const characteristic = this.characteristics.get(serviceUuid)?.get(characteristicUuid);

    if (characteristic === undefined) {
      throw new NobleError(`Unknown characteristic ${characteristicUuid} of service ${serviceUuid}: it has not been discovered on ${this.address}`);
    }

    return characteristic;
  }

  private getDescriptor (serviceUuid: string, characteristicUuid: string, descriptorUuid: string): DescriptorEntry {
    const descriptor = this.descriptors.get(serviceUuid)?.get(characteristicUuid)?.get(descriptorUuid);

    if (descriptor === undefined) {
      throw new NobleError(`Unknown descriptor ${descriptorUuid} of characteristic ${characteristicUuid} of service ${serviceUuid}: it has not been discovered on ${this.address}`);
    }

    return descriptor;
  }

  private onAclStreamData (data: Buffer): void {
    if (this.closeError !== null) {
      return;
    }

    const command = this.currentCommand;

    if (command && (data.toString('hex') === command.buffer.toString('hex'))) {
      debug(`${this.address}: echo ... echo ... echo ...`);
    } else if (data[0] % 2 === 0) {
      if (process.env.NOBLE_MULTI_ROLE) {
        debug(`${this.address}: multi-role flag in use, ignoring command meant for peripheral role.`);
      } else {
        const requestType = data[0];
        if (requestType === ATT_OP_MTU_REQ) {
          debug(`${this.address}: replying to MTU request`);
          this.writeAtt(this.mtuResponse(this.desiredMtu));
        } else {
          debug(`${this.address}: replying with REQ_NOT_SUPP to 0x${requestType.toString(16)}`);
          this.writeAtt(this.errorResponse(requestType, 0x0000, ATT_ECODE_REQ_NOT_SUPP));
        }
      }
    } else if (data[0] === ATT_OP_HANDLE_NOTIFY || data[0] === ATT_OP_HANDLE_IND) {
      const valueHandle = data.readUInt16LE(1);
      const valueData = data.slice(3);

      this.delegate.onHandleNotify(valueHandle, valueData);

      if (data[0] === ATT_OP_HANDLE_IND) {
        this.enqueue({ buffer: this.handleConfirmation(), written: new Deferred<void>() });
      }

      for (const serviceUuid of this.services.keys()) {
        const serviceCharacteristics = this.characteristics.get(serviceUuid);

        if (serviceCharacteristics === undefined) {
          continue;
        }

        for (const [characteristicUuid, characteristic] of serviceCharacteristics) {
          if (characteristic.valueHandle === valueHandle) {
            this.delegate.onNotification(serviceUuid, characteristicUuid, valueData);
          }
        }
      }
    } else if (!command) {
      debug(`${this.address}: uh oh, no current command`);
    } else {
      if (data[0] === ATT_OP_ERROR &&
          (data[4] === ATT_ECODE_AUTHENTICATION || data[4] === ATT_ECODE_AUTHORIZATION || data[4] === ATT_ECODE_INSUFF_ENC) &&
          this.security !== 'medium') {
        this.upgradeSecurity(command, data);
        return;
      }

      if (data[0] === ATT_OP_ERROR && data[4] === ATT_ECODE_INVALID_PDU) {
        debug('Error: can\'t change MTU, invalid PDU');
        return;
      }

      debug(`${this.address}: read: ${data.toString('hex')}`);

      command.response?.resolve(data);

      this.currentCommand = null;

      this.drain();
    }
  }

  /**
   * The peer refused the current command for lack of security: pair, then
   * send the very same command again. The command stays the current one (and
   * so keeps the queue blocked) in the meantime.
   */
  private upgradeSecurity (command: Command, errorResponse: Buffer): void {
    if (this.encrypting) {
      return;
    }

    this.encrypting = true;

    this.aclStream.encrypt().then(() => {
      this.encrypting = false;

      if (this.closeError !== null) {
        return;
      }

      this.security = 'medium';

      if (this.currentCommand !== null) {
        this.writeAtt(this.currentCommand.buffer);
      }
    }, (error: Error) => {
      this.encrypting = false;

      debug(`${this.address}: encryption failed: ${error.message}`);

      if (this.closeError !== null || this.currentCommand !== command) {
        return;
      }

      command.response?.reject(new AttError(errorResponse));

      this.currentCommand = null;

      this.drain();
    });
  }

  private writeAtt (data: Buffer): void {
    debug(`${this.address}: write: ${data.toString('hex')}`);
    this.aclStream.write(ATT_CID, data);
  }

  /** Queues a PDU the peer answers; settles with the response PDU, whatever its opcode. */
  private request (buffer: Buffer): Promise<Buffer> {
    const response = new Deferred<Buffer>();

    this.enqueue({ buffer, response });

    return response.promise;
  }

  /** Queues a PDU the peer does not answer; settles once it has been written. */
  private send (buffer: Buffer): Promise<void> {
    const written = new Deferred<void>();

    this.enqueue({ buffer, written });

    return written.promise;
  }

  private enqueue (command: Command): void {
    if (this.closeError !== null) {
      command.response?.reject(this.closeError);
      command.written?.reject(this.closeError);
      return;
    }

    this.commandQueue.push(command);

    if (this.currentCommand === null) {
      this.drain();
    }
  }

  /**
   * Writes queued commands until one that expects a response is out: there is
   * only ever one outstanding request, and commands without a response do not
   * block the queue.
   */
  private drain (): void {
    while (this.commandQueue.length) {
      const command = this.commandQueue.shift() as Command;

      this.currentCommand = command;

      this.writeAtt(command.buffer);

      if (command.response) {
        break;
      }

      command.written?.resolve();

      this.currentCommand = null;
    }
  }

  private errorResponse (opcode: number, handle: number, status: number): Buffer {
    const buf = Buffer.alloc(5);

    buf.writeUInt8(ATT_OP_ERROR, 0);
    buf.writeUInt8(opcode, 1);
    buf.writeUInt16LE(handle, 2);
    buf.writeUInt8(status, 4);

    return buf;
  }

  private mtuRequest (mtu: number): Buffer {
    const buf = Buffer.alloc(3);

    buf.writeUInt8(ATT_OP_MTU_REQ, 0);
    buf.writeUInt16LE(mtu, 1);

    return buf;
  }

  private mtuResponse (mtu: number): Buffer {
    const buf = Buffer.alloc(3);

    buf.writeUInt8(ATT_OP_MTU_RESP, 0);
    buf.writeUInt16LE(mtu, 1);

    return buf;
  }

  private readByGroupRequest (startHandle: number, endHandle: number, groupUuid: number): Buffer {
    const buf = Buffer.alloc(7);

    buf.writeUInt8(ATT_OP_READ_BY_GROUP_REQ, 0);
    buf.writeUInt16LE(startHandle, 1);
    buf.writeUInt16LE(endHandle, 3);
    buf.writeUInt16LE(groupUuid, 5);

    return buf;
  }

  private readByTypeRequest (startHandle: number, endHandle: number, groupUuid: number): Buffer {
    const buf = Buffer.alloc(7);

    buf.writeUInt8(ATT_OP_READ_BY_TYPE_REQ, 0);
    buf.writeUInt16LE(startHandle, 1);
    buf.writeUInt16LE(endHandle, 3);
    buf.writeUInt16LE(groupUuid, 5);

    return buf;
  }

  private readRequest (handle: number): Buffer {
    const buf = Buffer.alloc(3);

    buf.writeUInt8(ATT_OP_READ_REQ, 0);
    buf.writeUInt16LE(handle, 1);

    return buf;
  }

  private readBlobRequest (handle: number, offset: number): Buffer {
    const buf = Buffer.alloc(5);

    buf.writeUInt8(ATT_OP_READ_BLOB_REQ, 0);
    buf.writeUInt16LE(handle, 1);
    buf.writeUInt16LE(offset, 3);

    return buf;
  }

  private findInfoRequest (startHandle: number, endHandle: number): Buffer {
    const buf = Buffer.alloc(5);

    buf.writeUInt8(ATT_OP_FIND_INFO_REQ, 0);
    buf.writeUInt16LE(startHandle, 1);
    buf.writeUInt16LE(endHandle, 3);

    return buf;
  }

  private writeRequest (handle: number, data: Buffer, withoutResponse: boolean): Buffer {
    const buf = Buffer.alloc(3 + data.length);

    buf.writeUInt8(withoutResponse ? ATT_OP_WRITE_CMD : ATT_OP_WRITE_REQ, 0);
    buf.writeUInt16LE(handle, 1);

    for (let i = 0; i < data.length; i++) {
      buf.writeUInt8(data.readUInt8(i), i + 3);
    }

    return buf;
  }

  private prepareWriteRequest (handle: number, offset: number, data: Buffer): Buffer {
    const buf = Buffer.alloc(5 + data.length);

    buf.writeUInt8(ATT_OP_PREPARE_WRITE_REQ, 0);
    buf.writeUInt16LE(handle, 1);
    buf.writeUInt16LE(offset, 3);

    for (let i = 0; i < data.length; i++) {
      buf.writeUInt8(data.readUInt8(i), i + 5);
    }

    return buf;
  }

  // The handle is not part of the PDU: Execute Write applies to the whole prepare queue.
  private executeWriteRequest (_handle: number, cancelPreparedWrites?: boolean): Buffer {
    const buf = Buffer.alloc(2);

    buf.writeUInt8(ATT_OP_EXECUTE_WRITE_REQ, 0);
    buf.writeUInt8(cancelPreparedWrites ? 0 : 1, 1);

    return buf;
  }

  private handleConfirmation (): Buffer {
    const buf = Buffer.alloc(1);

    buf.writeUInt8(ATT_OP_HANDLE_CNF, 0);

    return buf;
  }
}

/** A 128-bit UUID as it appears on the wire (little endian), as a hex string. */
function uuid128 (data: Buffer, offset: number): string {
  return (data.slice(offset).slice(0, 16).toString('hex').match(/.{1,2}/g) ?? []).reverse().join('');
}
