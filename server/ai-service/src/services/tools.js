const { request } = require('./http');
const { redis } = require('../config/redis');
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, strict: true });
const validateSearchSchema = ajv.compile({
     type: 'object', additionalProperties: false,
     properties: {
          query: { type: 'string', maxLength: 160 },
          phrases: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string', maxLength: 80 } },
     },
});
const validateAddSchema = ajv.compile({
     type: 'object', additionalProperties: false,
     properties: { productId: { type: 'string', minLength: 1, maxLength: 100 }, quantity: { type: 'integer', minimum: 1, maximum: 10 } },
     required: ['productId', 'quantity'],
});

function cleanText(value, max = 160) {
     return String(value || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function validateSearchArgs(raw) {
     const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
     const sanitized = {};
     if (value.query !== undefined) {
          if (typeof value.query !== 'string' || value.query.length > 160) throw new Error('Invalid search query');
          sanitized.query = cleanText(value.query, 160);
     }
     if (value.phrases !== undefined) {
          if (!Array.isArray(value.phrases) || value.phrases.length < 2 || value.phrases.length > 4 || value.phrases.some((p) => typeof p !== 'string' || p.length > 80)) throw new Error('Use 2 to 4 situation phrases, each at most 80 characters');
          sanitized.phrases = value.phrases.map((p) => cleanText(p, 80));
     }
     if (!validateSearchSchema(sanitized)) throw new Error('Invalid product search arguments');
     return sanitized;
}
function validateAddArgs(raw) {
     const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
     const productId = typeof value.productId === 'string' ? value.productId.slice(0, 100) : '';
     const quantity = value.quantity === undefined ? 1 : value.quantity;
     const sanitized = { productId, quantity };
     if (!validateAddSchema(sanitized)) throw new Error('Invalid product or quantity');
     return sanitized;
}
function normalizeProduct(product, stock) {
     const id = product.productId || product.id;
     if (!id || product.isActive === false || product.active === false) return null;
     if (stock && (stock.inStock === false || !Number.isFinite(Number(stock.available)) || Number(stock.available) <= 0)) return null;
     if (product.inStock === false || (Number.isFinite(product.availableQuantity) && product.availableQuantity <= 0)) return null;
     return {
          productId: String(id), name: cleanText(product.name, 100),
          ...(product.price != null && Number.isFinite(Number(product.price)) ? { price: Number(product.price) } : {}),
          ...(product.compareAtPrice != null && Number.isFinite(Number(product.compareAtPrice)) ? { compareAtPrice: Number(product.compareAtPrice) } : {}),
          ...(typeof product.brand === 'string' ? { brand: cleanText(product.brand, 60) } : {}),
          ...(Array.isArray(product.images) && product.images[0] && /^https?:\/\//i.test(product.images[0]) ? { imageUrl: String(product.images[0]).slice(0, 500), images: [String(product.images[0]).slice(0, 500)] } : {}),
     };
}
async function searchProducts(raw) {
     const args = validateSearchArgs(raw);
     if (!args.phrases?.length && !args.query) throw new Error('Provide a query or phrases');
     const queries = args.phrases?.length ? args.phrases : [args.query];
     const found = new Map();
     for (const q of queries.filter(Boolean).slice(0, 4)) {
          const result = await request('search', `/products?q=${encodeURIComponent(q)}&inStockOnly=true&limit=10`);
          for (const product of result?.products || []) {
               const card = normalizeProduct(product);
               if (card) found.set(card.productId, card);
          }
     }
     const cards = [];
     for (const card of [...found.values()].slice(0, 10)) {
          try {
               const stock = await request('inventory', `/products/${encodeURIComponent(card.productId)}`);
               if (normalizeProduct({ ...card, isActive: true }, stock)) cards.push(card);
          } catch (_) { /* unavailable stock is excluded */ }
     }
     return cards;
}
async function addProductToCart(raw, userId, allowedIds) {
     const args = validateAddArgs(raw);
     if (!allowedIds.has(args.productId)) throw new Error('Choose a product from the products shown in this chat');
     const product = await request('catalog', `/products/${encodeURIComponent(args.productId)}`);
     if (product?.isActive === false || product?.active === false) throw new Error('This product is no longer available');
     const stock = await request('inventory', `/products/${encodeURIComponent(args.productId)}`);
     if (stock?.inStock === false || Number(stock?.available) < args.quantity) throw new Error('This product is not currently in stock');
     await request('cart', '/items', { method: 'POST', body: { productId: args.productId, quantity: args.quantity }, userId });
     return { added: true, productId: args.productId, quantity: args.quantity };
}
async function getCart(userId) {
     if (!userId) throw new Error('Sign in before checking out');
     return request('cart', '/', { userId });
}
async function recommendationProducts(productId, type) {
     const cacheKey = `ai:recommendation:${type}:${productId}`;
     const cached = await redis.get(cacheKey);
     if (cached) return JSON.parse(cached);
     const source = await request('catalog', `/products/${encodeURIComponent(productId)}`);
     if (!source || source.isActive === false) return popularProducts();
     let ids = [];
     if (type === 'together') ids = await redis.zrevrange(`ai:cooc:${productId}`, 0, 9);
     else {
          const found = await request('search', `/products?q=${encodeURIComponent(cleanText(source.name, 100))}&inStockOnly=true&limit=15`);
          ids = (found?.products || []).map((p) => p.productId || p.id).filter((id) => id && id !== productId);
     }
     const cards = await hydrateIds(ids, productId);
     const result = cards.length ? cards.slice(0, 8) : await popularProducts();
     await redis.set(cacheKey, JSON.stringify(result), 'EX', 180);
     return result;
}
async function hydrateIds(ids, excludeId) {
     const cards = [];
     for (const id of [...new Set(ids)].slice(0, 15)) {
          if (String(id) === String(excludeId)) continue;
          try {
               const product = await request('catalog', `/products/${encodeURIComponent(id)}`);
               const stock = await request('inventory', `/products/${encodeURIComponent(id)}`);
               const card = normalizeProduct(product, stock);
               if (card) cards.push(card);
          } catch (_) { /* omit products unavailable in catalog or inventory */ }
     }
     return cards;
}
async function popularProducts() {
     try {
          const cached = await redis.get('ai:recommendation:popular');
          if (cached) return JSON.parse(cached);
          const ids = await redis.zrevrange('ai:popular', 0, 9);
          const cards = await hydrateIds(ids);
          if (cards.length) {
               await redis.set('ai:recommendation:popular', JSON.stringify(cards), 'EX', 180);
               return cards;
          }
     } catch (_) { /* search provides a non-personalized fallback */ }
     const result = await request('search', '/products?inStockOnly=true&sort=newest&limit=8');
     const cards = [];
     for (const product of result?.products || []) {
          const card = normalizeProduct(product);
          if (!card) continue;
          try {
               const stock = await request('inventory', `/products/${encodeURIComponent(card.productId)}`);
               if (normalizeProduct({ ...card, isActive: true }, stock)) cards.push(card);
          } catch (_) { }
     }
     try { await redis.set('ai:recommendation:popular', JSON.stringify(cards), 'EX', 180); } catch (_) { }
     return cards;
}
module.exports = { cleanText, validateSearchArgs, validateAddArgs, normalizeProduct, searchProducts, addProductToCart, getCart, recommendationProducts, popularProducts, hydrateIds };
