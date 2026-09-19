import client from './client';

export const inventoryApi = {
  getStock: (productId) => client.get(`/inventory/products/${productId}`).then((r) => r.data),
  adjustStock: (productId, sku, delta) => client.post('/inventory/adjust', { productId, sku, delta }).then((r) => r.data),
};
