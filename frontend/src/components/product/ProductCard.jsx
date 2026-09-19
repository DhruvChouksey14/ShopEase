import { Link } from 'react-router-dom';
import { formatCurrency } from '../../utils/format';

export default function ProductCard({ product }) {
  const id = product.productId || product.id;
  const image = (product.images && product.images[0]) || 'https://placehold.co/400x400?text=No+Image';
  const outOfStock = product.inStock === false;

  return (
    <Link to={`/products/${id}`} className="group card p-3 hover:shadow-md transition-shadow block">
      <div className="aspect-square overflow-hidden rounded-lg bg-slate-100 mb-3">
        <img src={image} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
      </div>
      <p className="text-xs text-slate-400 uppercase tracking-wide">{product.brand || product.categoryName || ''}</p>
      <h3 className="font-semibold text-slate-900 line-clamp-2 mt-0.5">{product.name}</h3>
      <div className="flex items-center gap-2 mt-2">
        <span className="font-bold text-slate-900">{formatCurrency(product.price)}</span>
        {product.compareAtPrice > product.price && (
          <span className="text-sm text-slate-400 line-through">{formatCurrency(product.compareAtPrice)}</span>
        )}
      </div>
      {outOfStock && <span className="inline-block mt-2 text-xs font-semibold text-rose-600">Out of stock</span>}
    </Link>
  );
}
