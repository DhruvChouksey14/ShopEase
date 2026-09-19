import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { catalogApi } from '../api/catalog.api';
import { inventoryApi } from '../api/inventory.api';
import { useCartStore } from '../store/cart.store';
import { useAuthStore } from '../store/auth.store';
import { useToast } from '../components/ui/Toast';
import { formatCurrency } from '../utils/format';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';

export default function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [stock, setStock] = useState(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const addItem = useCartStore((s) => s.addItem);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const showToast = useToast();

  useEffect(() => {
    setLoading(true);
    Promise.all([catalogApi.getProduct(productId), inventoryApi.getStock(productId).catch(() => null)])
      .then(([productRes, stockRes]) => {
        setProduct(productRes.data);
        setStock(stockRes?.data || null);
      })
      .finally(() => setLoading(false));
  }, [productId]);

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      navigate(`/login?redirect=/products/${productId}`);
      return;
    }
    setAdding(true);
    try {
      await addItem(productId, qty);
      showToast('Added to cart', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to add to cart', 'error');
    } finally {
      setAdding(false);
    }
  };

  if (loading) return <div className="flex justify-center py-24"><Spinner /></div>;
  if (!product) return <div className="text-center py-24 text-slate-500">Product not found.</div>;

  const outOfStock = stock && !stock.inStock;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 grid md:grid-cols-2 gap-10">
      <div className="aspect-square rounded-xl overflow-hidden bg-slate-100">
        <img
          src={(product.images && product.images[0]) || 'https://placehold.co/600x600?text=No+Image'}
          alt={product.name}
          className="w-full h-full object-cover"
        />
      </div>

      <div>
        <p className="text-sm text-indigo-600 font-semibold uppercase tracking-wide">{product.category?.name}</p>
        <h1 className="text-3xl font-bold text-slate-900 mt-1">{product.name}</h1>
        {product.brand && <p className="text-slate-500 mt-1">by {product.brand}</p>}

        <div className="flex items-center gap-3 mt-4">
          <span className="text-2xl font-extrabold text-slate-900">{formatCurrency(product.price)}</span>
          {product.compareAtPrice > product.price && (
            <span className="text-lg text-slate-400 line-through">{formatCurrency(product.compareAtPrice)}</span>
          )}
        </div>

        {stock && (
          <p className={`mt-2 text-sm font-medium ${outOfStock ? 'text-rose-600' : 'text-emerald-600'}`}>
            {outOfStock ? 'Out of stock' : `${stock.available} in stock`}
          </p>
        )}

        {product.description && <p className="text-slate-600 mt-4 leading-relaxed">{product.description}</p>}

        <div className="flex items-center gap-3 mt-8">
          <div className="flex items-center border border-slate-300 rounded-lg">
            <button className="px-3 py-2 text-slate-600 hover:bg-slate-50" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
            <span className="px-4 font-medium">{qty}</span>
            <button className="px-3 py-2 text-slate-600 hover:bg-slate-50" onClick={() => setQty((q) => q + 1)}>+</button>
          </div>
          <Button onClick={handleAddToCart} loading={adding} disabled={outOfStock} className="flex-1">
            {outOfStock ? 'Out of Stock' : 'Add to Cart'}
          </Button>
        </div>
      </div>
    </div>
  );
}
