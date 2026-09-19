import { Link } from 'react-router-dom';
import OrderStatusBadge from './OrderStatusBadge';
import { formatCurrency, formatDateTime } from '../../utils/format';

export default function OrderCard({ order }) {
  return (
    <Link to={`/orders/${order.id}`} className="card p-4 flex items-center justify-between hover:shadow-md transition-shadow block">
      <div>
        <p className="font-semibold text-slate-900">Order #{order.id.slice(0, 8)}</p>
        <p className="text-sm text-slate-500 mt-0.5">{formatDateTime(order.createdAt)} · {order.items?.length || 0} item(s)</p>
      </div>
      <div className="text-right">
        <p className="font-bold text-slate-900">{formatCurrency(order.totalAmount)}</p>
        <div className="mt-1"><OrderStatusBadge status={order.status} /></div>
      </div>
    </Link>
  );
}
