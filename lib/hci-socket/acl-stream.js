const { EventEmitter } = require('events');
const Smp = require('./smp');

const AclStream = function (hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress) {
  this._hci = hci;
  this._handle = handle;

  this._smp = new Smp(this, localAddressType, localAddress, remoteAddressType, remoteAddress);

  this.onSmpStkBinded = this.onSmpStk.bind(this);
  this.onSmpFailBinded = this.onSmpFail.bind(this);
  this.onSmpEndBinded = this.onSmpEnd.bind(this);

  this._smp.on('stk', this.onSmpStkBinded);
  this._smp.on('fail', this.onSmpFailBinded);
  this._smp.on('end', this.onSmpEndBinded);
};

Object.setPrototypeOf(AclStream.prototype, EventEmitter.prototype);

AclStream.prototype.encrypt = function () {
  this._smp.sendPairingRequest();
};

AclStream.prototype.write = function (cid, data) {
  this._hci.writeAclDataPkt(this._handle, cid, data);
};

AclStream.prototype.push = function (cid, data) {
  if (data) {
    this.emit('data', cid, data);
  } else {
    this.emit('end');
  }
};

AclStream.prototype.pushEncrypt = function (encrypt) {
  this.emit('encrypt', encrypt);
};

AclStream.prototype.onSmpStk = function (stk) {
  const random = Buffer.from('0000000000000000', 'hex');
  const diversifier = Buffer.from('0000', 'hex');

  this._hci.startLeEncryption(this._handle, random, diversifier, stk);
};

AclStream.prototype.onSmpFail = function () {
  this.emit('encryptFail');
};

AclStream.prototype.onSmpEnd = function () {
  this._smp.removeListener('stk', this.onSmpStkBinded);
  this._smp.removeListener('fail', this.onSmpFailBinded);
  this._smp.removeListener('end', this.onSmpEndBinded);
};

module.exports = AclStream;
