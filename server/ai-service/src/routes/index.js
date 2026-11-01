const express = require('express');
const { internalAuth, requireUser } = require('../middleware/auth');
const { chat } = require('../services/chat.service');
const { recommendationProducts, popularProducts } = require('../services/tools');
const { request: recommendationRequest } = require('../services/recommendation');
const { publishUserEvents } = require('../kafka/producer');
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, strict: true });
const validateEvents = ajv.compile({
     type: 'object', additionalProperties: false, required: ['events'],
     properties: { events: { type: 'array', minItems: 1, maxItems: 20, items: {
          type: 'object', additionalProperties: false, required: ['eventType', 'productId'],
          properties: {
               eventType: { enum: ['product_view', 'add_to_cart', 'remove_from_cart', 'purchase', 'search_click'] },
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
          const result = await chat(req.user.id, req.body?.message);
          res.json({ success: true, data: result });
     } catch (error) {
          res.status(error.message.includes('characters') ? 400 : 503).json({ success: false, message: error.message });
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
     const events = req.body.events.map((event) => ({ ...event, userId, ts: event.ts || new Date().toISOString() }));
     try { await publishUserEvents(events); } catch (_) { /* telemetry must never block callers */ }
     res.status(202).json({ success: true, accepted: events.length });
});
module.exports = router;
