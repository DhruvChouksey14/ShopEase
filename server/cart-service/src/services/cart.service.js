const axios = require('axios');
const { redis } = require('../config/redis');
const { config } = require('../config');
const { BadRequestError, NotFoundError } = require('../utils/error');

const catalogClient = axios.create({
     baseURL: config.CATALOG_SERVICE_URL,
     timeout: 5000,
     headers: { 'Content-Type': 'application/json', 'x-internal-service-key': config.INTERNAL_SERVICE_KEY },
});

const cartKey = (userId) => `cart:${userId}`;

const readCart = async (userId) => {
     const raw = await redis.get(cartKey(userId));
     return raw ? JSON.parse(raw) : { items: [] };
};

const writeCart = async (userId, cart) => {
     await redis.set(cartKey(userId), JSON.stringify(cart), 'EX', config.CART_TTL_SECONDS);
};

// ─── Enrich cart items with live product data (name/price/image) for display ─
// The cart itself only ever stores {productId, quantity} — enrichment happens
// on every read so a price change in the catalog is reflected immediately in
// the cart UI (the order is only locked in at checkout, in order-service).

const enrichCart = async (cart) => {
     if (!cart.items.length) return { items: [], subtotal: 0 };

     const { data } = await catalogClient.post('/products/bulk', { ids: cart.items.map((i) => i.productId) });
     const productMap = new Map(data.data.map((p) => [p.id, p]));

     const items = [];
     let subtotal = 0;
     for (const item of cart.items) {
          const product = productMap.get(item.productId);
          if (!product) continue; // product deleted since it was added — silently drop from view
          const lineTotal = product.price * item.quantity;
          subtotal += lineTotal;
          items.push({
               productId: product.id,
               name: product.name,
               price: product.price,
               quantity: item.quantity,
               imageUrl: product.images?.[0] || null,
               inStock: product.isActive,
               lineTotal,
          });
     }
     return { items, subtotal };
};

const getCart = async (userId) => {
     const cart = await readCart(userId);
     return enrichCart(cart);
};

const addItem = async (userId, productId, quantity) => {
     if (!productId || !quantity || quantity < 1) throw new BadRequestError('productId and a positive quantity are required');

     const { data } = await catalogClient.get(`/products/${productId}`).catch(() => ({ data: null }));
     if (!data || !data.data || !data.data.isActive) throw new NotFoundError('Product not found or unavailable');

     const cart = await readCart(userId);
     const existing = cart.items.find((i) => i.productId === productId);
     if (existing) existing.quantity += quantity;
     else cart.items.push({ productId, quantity });

     await writeCart(userId, cart);
     return enrichCart(cart);
};

const updateItem = async (userId, productId, quantity) => {
     if (quantity < 0) throw new BadRequestError('quantity cannot be negative');
     const cart = await readCart(userId);
     const existing = cart.items.find((i) => i.productId === productId);
     if (!existing) throw new NotFoundError('Item not in cart');

     if (quantity === 0) {
          cart.items = cart.items.filter((i) => i.productId !== productId);
     } else {
          existing.quantity = quantity;
     }

     await writeCart(userId, cart);
     return enrichCart(cart);
};

const removeItem = async (userId, productId) => {
     const cart = await readCart(userId);
     cart.items = cart.items.filter((i) => i.productId !== productId);
     await writeCart(userId, cart);
     return enrichCart(cart);
};

const clearCart = async (userId) => {
     await redis.del(cartKey(userId));
     return { items: [], subtotal: 0 };
};

// ─── Internal API used by order-service at checkout ──────────────────────────

const getRawCart = async (userId) => readCart(userId);

module.exports = { getCart, addItem, updateItem, removeItem, clearCart, getRawCart };
