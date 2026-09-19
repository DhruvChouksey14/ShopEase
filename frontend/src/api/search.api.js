import client from './client';

export const searchApi = {
  searchProducts: (params) => client.get('/search/products', { params }).then((r) => r.data),
  autocomplete: (q) => client.get('/search/autocomplete', { params: { q } }).then((r) => r.data),
};
