import client from './client';

export const cartApi = {
  getCart: () => client.get('/cart').then((r) => r.data),
  addItem: (productId, quantity = 1) => client.post('/cart/items', { productId, quantity }).then((r) => r.data),
  updateItem: (productId, quantity) => client.put(`/cart/items/${productId}`, { quantity }).then((r) => r.data),
  removeItem: (productId) => client.delete(`/cart/items/${productId}`).then((r) => r.data),
  clearCart: () => client.delete('/cart').then((r) => r.data),
};
