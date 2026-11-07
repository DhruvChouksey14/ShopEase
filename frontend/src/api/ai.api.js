import client from './client';
const sessionId = typeof window !== 'undefined' ? (sessionStorage.getItem('shopease_session_id') || (() => { const value = crypto.randomUUID(); sessionStorage.setItem('shopease_session_id', value); return value; })()) : undefined;
export const aiApi = {
  chat: (message) => client.post('/ai/chat', { message }).then((r) => r.data.data),
  recommendations: (productId, type = 'similar') => client.get(`/ai/recommendations/product/${encodeURIComponent(productId)}`, { params: { type } }).then((r) => r.data.data.products || []),
  popular: () => client.get('/ai/recommendations/popular').then((r) => r.data.data.products || []),
  user: () => client.get('/ai/recommendations/user', { params: { sessionId } }).then((r) => r.data.data.products || []),
  cart: (productIds) => client.get('/ai/recommendations/cart', { params: { productIds: productIds.join(',') } }).then((r) => r.data.data.products || []),
  trackEvent: (event) => client.post('/ai/events', { events: [{ ...event, sessionId: event.sessionId || sessionId }] }).catch(() => undefined),
};
