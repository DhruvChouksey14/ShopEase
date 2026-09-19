import client from './client';

export const orderApi = {
  createOrder: (shippingAddress, idempotencyKey) => client.post('/orders', { shippingAddress, idempotencyKey }).then((r) => r.data),
  getMyOrders: (params) => client.get('/orders', { params }).then((r) => r.data),
  getOrder: (orderId) => client.get(`/orders/${orderId}`).then((r) => r.data),
  verifyPayment: (orderId, razorpayPaymentId, razorpaySignature) =>
    client.post(`/orders/${orderId}/verify-payment`, { razorpayPaymentId, razorpaySignature }).then((r) => r.data),
  cancelOrder: (orderId) => client.post(`/orders/${orderId}/cancel`).then((r) => r.data),
  getAllOrders: (params) => client.get('/orders/admin/all', { params }).then((r) => r.data),
  shipOrder: (orderId, trackingNumber) => client.post(`/orders/${orderId}/ship`, { trackingNumber }).then((r) => r.data),
};
