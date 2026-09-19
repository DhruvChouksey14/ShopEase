const axios = require('axios');
const { config } = require('../config');

const client = axios.create({
     baseURL: config.CART_SERVICE_URL,
     timeout: 5000,
     headers: { 'Content-Type': 'application/json', 'x-internal-service-key': config.INTERNAL_SERVICE_KEY },
});

const cartClient = {
     async getCart(userId) {
          const { data } = await client.get(`/internal/${userId}`);
          return data.data;
     },
     async clearCart(userId) {
          const { data } = await client.delete(`/internal/${userId}`);
          return data.data;
     },
};

module.exports = { cartClient };
