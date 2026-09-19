import { ORDER_STATUS_COLORS, ORDER_STATUS_LABELS } from '../../utils/constants';

export default function OrderStatusBadge({ status }) {
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${ORDER_STATUS_COLORS[status] || 'bg-slate-100 text-slate-700'}`}>
      {ORDER_STATUS_LABELS[status] || status}
    </span>
  );
}
