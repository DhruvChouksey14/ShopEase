import client from './client';

export const catalogApi = {
  getCategories: () => client.get('/catalog/categories').then((r) => r.data),
  getProducts: (params) => client.get('/catalog/products', { params }).then((r) => r.data),
  getProduct: (id) => client.get(`/catalog/products/${id}`).then((r) => r.data),
  createCategory: (data) => client.post('/catalog/categories', data).then((r) => r.data),
  createProduct: (data) => client.post('/catalog/products', data).then((r) => r.data),
  updateProduct: (id, data) => client.put(`/catalog/products/${id}`, data).then((r) => r.data),
  deleteProduct: (id) => client.delete(`/catalog/products/${id}`).then((r) => r.data),
};
