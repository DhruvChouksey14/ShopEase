import { useEffect, useState } from 'react';
import { orderApi } from '../api/order.api';
import OrderCard from '../components/order/OrderCard';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    orderApi.getMyOrders().then((res) => setOrders(res.data?.orders || [])).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-24"><Spinner /></div>;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">My Orders</h1>
      {orders.length === 0 ? (
        <EmptyState title="No orders yet" message="Your order history will show up here.">
          <Link to="/products"><Button>Start Shopping</Button></Link>
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => <OrderCard key={o.id} order={o} />)}
        </div>
      )}
    </div>
  );
}
