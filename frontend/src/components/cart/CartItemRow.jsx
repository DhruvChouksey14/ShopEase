import { formatCurrency } from '../../utils/format';

export default function CartItemRow({ item, onUpdateQty, onRemove }) {
  return (
    <div className="flex items-center gap-4 py-4 border-b border-slate-100 last:border-0">
      <img src={item.imageUrl || 'https://placehold.co/80x80?text=No+Image'} alt={item.name} className="w-16 h-16 rounded-lg object-cover bg-slate-100" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-900 truncate">{item.name}</p>
        <p className="text-sm text-slate-500">{formatCurrency(item.price)} each</p>
        {!item.inStock && <p className="text-xs text-rose-600 font-medium mt-0.5">No longer available</p>}
      </div>
      <div className="flex items-center border border-slate-300 rounded-lg">
        <button className="px-2.5 py-1 text-slate-600 hover:bg-slate-50" onClick={() => onUpdateQty(item.productId, Math.max(0, item.quantity - 1))}>−</button>
        <span className="px-3 text-sm font-medium">{item.quantity}</span>
        <button className="px-2.5 py-1 text-slate-600 hover:bg-slate-50" onClick={() => onUpdateQty(item.productId, item.quantity + 1)}>+</button>
      </div>
      <div className="w-20 text-right font-semibold text-slate-900">{formatCurrency(item.lineTotal)}</div>
      <button onClick={() => onRemove(item.productId)} className="text-slate-400 hover:text-rose-600 text-sm">✕</button>
    </div>
  );
}
