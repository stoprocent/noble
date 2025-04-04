const { EventEmitter } = require('events');
const { resolve } = require('path');
const dir = resolve(__dirname, '..', '..');
const binding = require('node-gyp-build')(dir);
const { NobleMac } = binding;

Object.setPrototypeOf(NobleMac.prototype, EventEmitter.prototype);

module.exports = NobleMac;
