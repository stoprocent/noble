const UINT32_MAX = 0xFFFFFFFF;

module.exports = function isUint32 (value) {
  return Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
};
