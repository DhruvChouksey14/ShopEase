const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const RazorpayGateway = require('../src/services/gateways/razorpay.gateway');

const gateway = Object.create(RazorpayGateway.prototype);
gateway.keySecret = 'test-secret';

function validSignature() {
     return crypto.createHmac('sha256', gateway.keySecret).update('order-1|payment-1').digest('hex');
}

test('accepts a valid payment signature', () => {
     assert.equal(gateway.verifyPaymentSignature('order-1', 'payment-1', validSignature()), true);
});

test('rejects a wrong-length payment signature', () => {
     assert.equal(gateway.verifyPaymentSignature('order-1', 'payment-1', '00'), false);
});

test('rejects a non-hex payment signature', () => {
     assert.equal(gateway.verifyPaymentSignature('order-1', 'payment-1', 'z'.repeat(64)), false);
});

test('rejects a tampered payment signature', () => {
     const signature = validSignature();
     const tampered = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
     assert.equal(gateway.verifyPaymentSignature('order-1', 'payment-1', tampered), false);
});