const axios = require('axios');
const { config } = require('../config');

const client = axios.create({
     baseURL: config.USER_SERVICE_URL,
     timeout: 5000,
     headers: { 'Content-Type': 'application/json', 'x-internal-service-key': config.INTERNAL_SERVICE_KEY },
});

const userClient = {
     async getUserById(userId) {
          const { data } = await client.get(`/user/internal/${userId}`);
          return data.data;
     },
};

module.exports = { userClient };
