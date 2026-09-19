import { useEffect, useState } from 'react';
import { orderApi } from '../../api/order.api';
import { useToast } from '../ui/Toast';
import OrderStatusBadge from '../order/OrderStatusBadge';
import { formatCurrency, formatDateTime } from '../../utils/format';
import Button from '../ui/Button';

export default function OrderManager() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const showToast = useToast();

  const load = () => orderApi.getAllOrders({ limit: 50 }).then((res) => setOrders(res.data?.orders || [])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleShip = async (orderId) => {
    const trackingNumber = prompt('Enter tracking number (optional):') || undefined;
    try {
      await orderApi.shipOrder(orderId, trackingNumber);
      load();
      showToast('Order marked as shipped', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update order', 'error');
    }
  };

  if (loading) return <p className="text-slate-500">Loading orders...</p>;

  return (
    <div className="card p-4">
      <h3 className="font-semibold text-slate-900 mb-3">All Orders ({orders.length})</h3>
      <div className="divide-y divide-slate-100">
        {orders.map((o) => (
          <div key={o.id} className="py-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-slate-800">#{o.id.slice(0, 8)}</p>
              <p className="text-xs text-slate-500">{formatDateTime(o.createdAt)} · {formatCurrency(o.totalAmount)}</p>
            </div>
            <div className="flex items-center gap-3">
              <OrderStatusBadge status={o.status} />
              {o.status === 'CONFIRMED' && (
                <Button variant="secondary" onClick={() => handleShip(o.id)} className="text-xs px-2 py-1">Mark Shipped</Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
