var debug = require('debug')('hci-serial-parser');
const { Transform } = require('stream');

var HCI_COMMAND_PKT = 0x01;
var HCI_ACLDATA_PKT = 0x02;
var HCI_EVENT_PKT = 0x04;

class HciSerialParser extends Transform {
    constructor(options) {
      super();
      this.reset();
    }
  
    _transform(chunk, encoding, cb) {
      this.packetData = Buffer.concat([this.packetData, chunk]);
         
      debug("HciPacketParser._transform: ", this.packetData.toString("hex"));    
  
      if (this.packetType == -1) {
        this.packetType = this.packetData.readUInt8(0);
      }
  
      if (this.listenerCount("raw") > 0) {
        this.emit('raw', this.packetData);
      }
  
      var skipPacket = false
      while(this.packetData.length >= this.packetSize + this.prePacketSize && !skipPacket) {
  
        if (this.packetSize === 0 && (this.packetType == HCI_EVENT_PKT || this.packetType == HCI_COMMAND_PKT) && this.packetData.length >= 3) {
          this.packetSize = this.packetData.readUInt8(2);
          this.prePacketSize = 3;
        }
        else if (this.packetSize === 0 && this.packetType == HCI_ACLDATA_PKT && this.packetData.length >= 5) {
          this.packetSize = this.packetData.readUInt16LE(3);
          this.prePacketSize = 5;
        }
        
        if(this.packetData.length < this.packetSize + this.prePacketSize || this.packetSize == 0) {
          skipPacket = true; continue;
        }
  
        this.push(this.packetData.subarray(0, this.packetSize + this.prePacketSize));
        
        this.packetData = this.packetData.subarray(this.packetSize + this.prePacketSize);
        this.packetSize = 0;
        this.prePacketSize = 0;
  
        if (this.packetData.length > 0) {
          this.packetType = this.packetData.readUInt8(0);
        }
        else {
          this.packetType = -1;
        }
      }
      cb()    
    }

    reset() {
        this.packetSize = 0;
        this.prePacketSize = 0;
        this.packetType = -1;
        this.packetData = Buffer.alloc(0);
    }
  
    _flush(cb) {
      this.emit('raw', this.packetData);
      this.reset();
      cb()
    }
  }

  module.exports = HciSerialParser;
  