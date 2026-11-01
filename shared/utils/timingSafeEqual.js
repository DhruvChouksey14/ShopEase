const crypto = require('crypto');

function timingSafeEqual(left, right) {
     if (typeof left !== 'string' || typeof right !== 'string') return false;

     const leftBuffer = Buffer.from(left);
     const rightBuffer = Buffer.from(right);
     if (leftBuffer.length !== rightBuffer.length) return false;

     return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = { timingSafeEqual };