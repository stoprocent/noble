const { EventEmitter } = require('events');
const { resolve } = require('path');
const dir = resolve(__dirname, '..', '..');
const binding = require('node-gyp-build')(dir);
const { NobleWinrt } = binding;

Object.setPrototypeOf(NobleWinrt.prototype, EventEmitter.prototype);

module.exports = NobleWinrt;
