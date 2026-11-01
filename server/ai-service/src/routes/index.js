const express = require('express');
const { internalAuth, requireUser } = require('../middleware/auth');
const { chat } = require('../services/chat.service');
const { recommendationProducts, popularProducts } = require('../services/tools');
const { request: recommendationRequest } = require('../services/recommendation');
const { publishUserEvents } = require('../kafka/producer');
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, strict: true });
class ChatInputError extends Error {}
const sanitizeTimestamp = (value, now = Date.now()) => {
     const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
     return Number.isFinite(parsed) && parsed >= now - 24 * 60 * 60 * 1000 && parsed <= now + 5 * 60 * 1000 ? new Date(parsed).toISOString() : new Date(now).toISOString();
};
const validateEvents = ajv.compile({
     type: 'object', additionalProperties: false, required: ['events'],
     properties: { events: { type: 'array', minItems: 1, maxItems: 20, items: {
          type: 'object', additionalProperties: false, required: ['eventType', 'productId'],
          properties: {
               eventType: { enum: ['product_view', 'add_to_cart', 'remove_from_cart', 'search_click'] },
               productId: { type: 'string', minLength: 1, maxLength: 100 },
               sessionId: { type: 'string', minLength: 1, maxLength: 120 },
               query: { type: 'string', maxLength: 160 }, ts: { type: 'string', maxLength: 40 },
          },
     } } },
});
const router = express.Router();

router.use(internalAuth);
router.post('/chat', requireUser, async (req, res, next) => {
     try {
          const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
          if (!message || message.length > 1000) throw new ChatInputError('Message must contain 1 to 1000 characters');
          const result = await chat(req.user.id, message);
          res.json({ success: true, data: result });
     } catch (error) {
          if (error instanceof ChatInputError) return res.status(400).json({ success: false, message: error.message });
          console.error('AI chat failed', { name: error.name, message: error.message });
          res.status(503).json({ success: false, message: 'The assistant is temporarily unavailable.' });
     }
});
router.get('/recommendations/product/:productId', async (req, res, next) => {
     try {
          if (!/^(similar|together)$/.test(req.query.type || 'similar')) return res.status(400).json({ success: false, message: 'type must be similar or together' });
          let products;
          try {
               const ids = await recommendationRequest(`/recommendations/product/${encodeURIComponent(req.params.productId)}`, { query: { type: req.query.type || 'similar' } });
               products = await require('../services/tools').hydrateIds(ids.map((item) => item.productId), req.params.productId);
               if (!products.length) products = await recommendationProducts(req.params.productId, req.query.type || 'similar');
          } catch (_) { products = await recommendationProducts(req.params.productId, req.query.type || 'similar'); }
          res.json({ success: true, data: { products } });
     } catch (_) { res.json({ success: true, data: { products: await popularProducts().catch(() => []) } }); }
});
router.get('/recommendations/popular', async (req, res) => {
     let products;
     try { const ids = await recommendationRequest('/recommendations/popular'); products = await require('../services/tools').hydrateIds(ids.map((item) => item.productId)); if (!products.length) products = await popularProducts(); }
     catch (_) { products = await popularProducts().catch(() => []); }
     res.json({ success: true, data: { products } });
});
router.get('/recommendations/user', async (req, res) => {
     try {
          const ids = await recommendationRequest('/recommendations/user', { userId: req.get('x-user-id'), query: { sessionId: req.query.sessionId } });
          let products = await require('../services/tools').hydrateIds(ids.map((item) => item.productId));
          if (!products.length) products = await popularProducts();
          res.json({ success: true, data: { products } });
     } catch (_) { res.json({ success: true, data: { products: await popularProducts().catch(() => []) } }); }
});
router.get('/recommendations/cart', async (req, res) => {
     try {
          const ids = await recommendationRequest('/recommendations/cart', { query: { productIds: req.query.productIds } });
          let products = await require('../services/tools').hydrateIds(ids.map((item) => item.productId));
          if (!products.length) products = await popularProducts();
          res.json({ success: true, data: { products } });
     } catch (_) { res.json({ success: true, data: { products: await popularProducts().catch(() => []) } }); }
});
router.post('/events', async (req, res) => {
     if (!validateEvents(req.body)) return res.status(400).json({ success: false, message: 'Invalid events payload' });
     const userId = req.get('x-user-id') || undefined;
     const events = req.body.events.map((event) => ({ ...event, userId, ts: sanitizeTimestamp(event.ts) }));
     try { await publishUserEvents(events); } catch (_) { /* telemetry must never block callers */ }
     res.status(202).json({ success: true, accepted: events.length });
});
module.exports = router;
module.exports.validateEvents = validateEvents;
module.exports.sanitizeTimestamp = sanitizeTimestamp;
module.exports.ChatInputError = ChatInputError;
