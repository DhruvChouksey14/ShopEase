import { io } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_ORDER_SERVICE_WS_URL || 'http://localhost:4005';

let socket = null;

/**
 * Connects directly to order-service's Socket.IO server (bypasses the HTTP
 * gateway proxy — WebSocket upgrades don't go through the REST proxy layer).
 * Auth reuses the same httpOnly accessToken cookie the REST API uses
 * (withCredentials sends it automatically; the server parses it from the
 * handshake headers — see order-service/src/sockets/io.js).
 */
export function connectOrderSocket() {
  if (socket?.connected) return socket;

  socket = io(WS_URL, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
  });

  socket.on('connect_error', (err) => {
    console.warn('Order status socket connection error:', err.message);
  });

  return socket;
}

export function disconnectOrderSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getOrderSocket() {
  return socket;
}
