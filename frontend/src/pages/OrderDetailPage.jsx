import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { orderApi } from '../api/order.api';
import { connectOrderSocket, disconnectOrderSocket } from '../utils/socket';
import { useToast } from '../components/ui/Toast';
import OrderStatusBadge from '../components/order/OrderStatusBadge';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { formatCurrency, formatDateTime } from '../utils/format';

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [live, setLive] = useState(false);
  const showToast = useToast();

  const loadOrder = useCallback(() => {
    return orderApi.getOrder(orderId).then((res) => setOrder(res.data));
  }, [orderId]);

  useEffect(() => {
    setLoading(true);
    loadOrder().finally(() => setLoading(false));
  }, [loadOrder]);

  // Real-time order status — pushed over WebSocket by order-service the moment
  // the saga transitions state (no polling needed).
  useEffect(() => {
    const socket = connectOrderSocket();

    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));

    const handler = (payload) => {
      if (payload.orderId !== orderId) return;
      setOrder((prev) => (prev ? { ...prev, status: payload.status } : prev));
      showToast(`Order status updated: ${payload.status.replace(/_/g, ' ')}`, 'info');
    };
    socket.on('order:status', handler);

    return () => {
      socket.off('order:status', handler);
      disconnectOrderSocket();
    };
  }, [orderId, showToast]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await orderApi.cancelOrder(orderId);
      await loadOrder();
      showToast('Order cancelled', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to cancel order', 'error');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (!order) return <div className="text-center py-24 text-slate-500">Order not found.</div>;

  const canCancel = ['PENDING', 'STOCK_RESERVED', 'PAYMENT_PENDING', 'CONFIRMED'].includes(order.status);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Order #{order.id.slice(0, 8)}</h1>
          <p className="text-sm text-slate-500 mt-1">Placed {formatDateTime(order.createdAt)}</p>
        </div>
        <div className="text-right">
          <OrderStatusBadge status={order.status} />
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1 justify-end">
            <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            {live ? 'Live updates connected' : 'Connecting...'}
          </p>
        </div>
      </div>

      <div className="card p-5 mb-4">
        <h2 className="font-semibold text-slate-900 mb-3">Items</h2>
        {order.items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
            <img src={item.imageUrl || 'https://placehold.co/56x56?text=No+Image'} className="w-12 h-12 rounded-lg object-cover bg-slate-100" alt={item.name} />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900">{item.name}</p>
              <p className="text-xs text-slate-500">Qty {item.quantity} × {formatCurrency(item.price)}</p>
            </div>
            <p className="text-sm font-semibold text-slate-900">{formatCurrency(item.price * item.quantity)}</p>
          </div>
        ))}
        <div className="flex justify-between font-bold text-slate-900 pt-3 mt-2 border-t border-slate-100">
          <span>Total</span>
          <span>{formatCurrency(order.totalAmount)}</span>
        </div>
      </div>

      {order.shippingAddress && (
        <div className="card p-5 mb-4">
          <h2 className="font-semibold text-slate-900 mb-2">Shipping Address</h2>
          <p className="text-sm text-slate-600">
            {order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}<br />
            {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}<br />
            {order.shippingAddress.country}
          </p>
        </div>
      )}

      {order.failureReason && (
        <div className="card p-4 mb-4 bg-rose-50 border-rose-200">
          <p className="text-sm text-rose-700"><strong>Note:</strong> {order.failureReason.replace(/_/g, ' ')}</p>
        </div>
      )}

      {canCancel && (
        <Button variant="danger" onClick={handleCancel} loading={cancelling}>Cancel Order</Button>
      )}
    </div>
  );
}
