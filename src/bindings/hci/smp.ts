import createDebug from 'debug';

import * as crypto from './crypto';
import type { HciAddressType, L2capChannelHandler } from './types';

const debug = createDebug('smp');

const SMP_CID = 0x0006;

const SMP_PAIRING_REQUEST = 0x01;
const SMP_PAIRING_RESPONSE = 0x02;
const SMP_PAIRING_CONFIRM = 0x03;
const SMP_PAIRING_RANDOM = 0x04;
const SMP_PAIRING_FAILED = 0x05;
const SMP_ENCRYPT_INFO = 0x06;
const SMP_MASTER_IDENT = 0x07;

/** Outcome of the pairing procedure, reported by `Smp` to its owner. */
export interface SmpDelegate {
  onStk (stk: Buffer): void;
  onFail (): void;
  onLtk? (ltk: Buffer): void;
  onMasterIdent? (ediv: Buffer, rand: Buffer): void;
}

/** The slice of `AclStream` that `Smp` drives. */
export interface SmpChannel {
  registerChannel (cid: number, handler: L2capChannelHandler): void;
  write (cid: number, data: Buffer): void;
}

/** Security Manager Protocol, initiator side, LE legacy "Just Works" pairing. */
export class Smp {
  private readonly iat: Buffer;
  private readonly ia: Buffer;
  private readonly rat: Buffer;
  private readonly ra: Buffer;

  private preq: Buffer | null = null;
  private pres: Buffer | null = null;
  private tk: Buffer | null = null;
  private r: Buffer | null = null;
  private pcnf: Buffer | null = null;

  constructor (
    private readonly aclStream: SmpChannel,
    localAddressType: HciAddressType,
    localAddress: string,
    remoteAddressType: HciAddressType,
    remoteAddress: string,
    private readonly delegate: SmpDelegate
  ) {
    this.iat = Buffer.from([(localAddressType === 'random') ? 0x01 : 0x00]);
    this.ia = Buffer.from(localAddress.split(':').reverse().join(''), 'hex');
    this.rat = Buffer.from([(remoteAddressType === 'random') ? 0x01 : 0x00]);
    this.ra = Buffer.from(remoteAddress.split(':').reverse().join(''), 'hex');

    this.aclStream.registerChannel(SMP_CID, (data) => this.onAclStreamData(data));
  }

  sendPairingRequest (): void {
    this.preq = Buffer.from([
      SMP_PAIRING_REQUEST,
      0x03, // IO capability: NoInputNoOutput
      0x00, // OOB data: Authentication data not present
      0x01, // Authentication requirement: Bonding - No MITM
      0x10, // Max encryption key size
      0x00, // Initiator key distribution: <none>
      0x01 // Responder key distribution: EncKey
    ]);

    this.write(this.preq);
  }

  private onAclStreamData (data: Buffer): void {
    const code = data.readUInt8(0);

    if (SMP_PAIRING_RESPONSE === code) {
      this.handlePairingResponse(data);
    } else if (SMP_PAIRING_CONFIRM === code) {
      this.handlePairingConfirm(data);
    } else if (SMP_PAIRING_RANDOM === code) {
      this.handlePairingRandom(data);
    } else if (SMP_PAIRING_FAILED === code) {
      this.handlePairingFailed();
    } else if (SMP_ENCRYPT_INFO === code) {
      this.handleEncryptInfo(data);
    } else if (SMP_MASTER_IDENT === code) {
      this.handleMasterIdent(data);
    }
  }

  private handlePairingResponse (data: Buffer): void {
    if (this.preq === null) {
      debug('pairing response without a pairing request, ignoring');
      return;
    }

    this.pres = data;

    this.tk = Buffer.from('00000000000000000000000000000000', 'hex');
    this.r = crypto.r();

    this.write(Buffer.concat([
      Buffer.from([SMP_PAIRING_CONFIRM]),
      crypto.c1(this.tk, this.r, this.pres, this.preq, this.iat, this.ia, this.rat, this.ra)
    ]));
  }

  private handlePairingConfirm (data: Buffer): void {
    if (this.r === null) {
      debug('pairing confirm without a pairing response, ignoring');
      return;
    }

    this.pcnf = data;

    this.write(Buffer.concat([
      Buffer.from([SMP_PAIRING_RANDOM]),
      this.r
    ]));
  }

  private handlePairingRandom (data: Buffer): void {
    if (this.preq === null || this.pres === null || this.tk === null || this.r === null || this.pcnf === null) {
      debug('pairing random without a pairing confirm, ignoring');
      return;
    }

    const r = data.slice(1);

    const pcnf = Buffer.concat([
      Buffer.from([SMP_PAIRING_CONFIRM]),
      crypto.c1(this.tk, r, this.pres, this.preq, this.iat, this.ia, this.rat, this.ra)
    ]);

    if (this.pcnf.toString('hex') === pcnf.toString('hex')) {
      const stk = crypto.s1(this.tk, r, this.r);

      this.delegate.onStk(stk);
    } else {
      this.write(Buffer.from([
        SMP_PAIRING_RANDOM,
        SMP_PAIRING_CONFIRM
      ]));

      this.delegate.onFail();
    }
  }

  private handlePairingFailed (): void {
    this.delegate.onFail();
  }

  private handleEncryptInfo (data: Buffer): void {
    const ltk = data.slice(1);

    this.delegate.onLtk?.(ltk);
  }

  private handleMasterIdent (data: Buffer): void {
    const ediv = data.slice(1, 3);
    const rand = data.slice(3);

    this.delegate.onMasterIdent?.(ediv, rand);
  }

  private write (data: Buffer): void {
    this.aclStream.write(SMP_CID, data);
  }
}
