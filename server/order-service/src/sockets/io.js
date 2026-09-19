/**
 * Real-time order status updates via Socket.IO (WebSocket, falls back to
 * HTTP long-polling automatically if a client can't hold a WS connection).
 *
 * Clients connect with their JWT access token and are placed into a private
 * room `user:{userId}`, so order-status events are only ever delivered to
 * the user who owns that order.
 */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { config } = require('../config');

let io = null;

function extractToken(socket) {
     // Browser clients: httpOnly `accessToken` cookie (same one the REST API uses)
     const rawCookie = socket.handshake.headers?.cookie;
     if (rawCookie) {
          const parsed = cookie.parse(rawCookie);
          if (parsed.accessToken) return parsed.accessToken;
     }
     // Non-browser clients (mobile apps, service tests): explicit auth token
     return socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
}

function initSocketServer(httpServer) {
     io = new Server(httpServer, {
          cors: { origin: config.ALLOWED_ORIGINS?.split(',') || '*', credentials: true },
          path: '/socket.io',
     });

     io.use((socket, next) => {
          try {
               const token = extractToken(socket);
               if (!token) return next(new Error('Authentication token required'));

               const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
               socket.userId = decoded.id;
               if (!socket.userId) return next(new Error('Invalid token payload'));
               next();
          } catch (err) {
               next(new Error('Invalid or expired token'));
          }
     });

     io.on('connection', (socket) => {
          socket.join(`user:${socket.userId}`);
          console.log(`Socket connected for user ${socket.userId}`, { socketId: socket.id });

          socket.on('disconnect', () => {
               console.log(`Socket disconnected for user ${socket.userId}`);
          });
     });

     console.log('Socket.IO server initialized');
     return io;
}

/** Push a live order-status event to every tab/device the user has open. */
function emitOrderStatus(userId, payload) {
     if (!io) return;
     io.to(`user:${userId}`).emit('order:status', payload);
}

function getIO() {
     if (!io) throw new Error('Socket.IO not initialized yet');
     return io;
}

module.exports = { initSocketServer, emitOrderStatus, getIO };
