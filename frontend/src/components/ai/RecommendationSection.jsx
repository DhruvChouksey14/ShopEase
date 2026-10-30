import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiApi } from '../../api/ai.api';
import { useCartStore } from '../../store/cart.store';
import { useAuthStore } from '../../store/auth.store';
import { useToast } from '../ui/Toast';
import { formatCurrency } from '../../utils/format';

export default function RecommendationSection({ productId, type = 'similar', title, source }) {
  const [products, setProducts] = useState([]);
  const addItem = useCartStore((s) => s.addItem);
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const toast = useToast();
  useEffect(() => {
    let active = true;
    const request = source === 'user' ? aiApi.user() : source === 'cart' ? aiApi.cart(productId || []) : source === 'popular' ? aiApi.popular() : aiApi.recommendations(productId, type);
    request.then((items) => active && setProducts(items)).catch(() => {});
    return () => { active = false; };
  }, [productId, type, source]);
  if (!products.length) return null;
  return <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
    <h2 className="text-xl font-bold mb-4">{title}</h2>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{products.map((p) => <article key={p.productId} className="border rounded-xl p-3">
      <Link to={`/products/${encodeURIComponent(p.productId)}`}>
        {p.imageUrl && <img src={p.imageUrl} alt="" className="aspect-square w-full rounded-lg object-cover" />}
        <h3 className="font-semibold mt-2">{p.name}</h3>
        {Number.isFinite(p.price) && <p className="font-bold">{formatCurrency(p.price)}</p>}
      </Link>
      <button className="mt-2 text-indigo-700 font-medium" onClick={async () => {
        if (!authenticated) { toast('Sign in to add products to your cart', 'error'); return; }
        try { await addItem(p.productId, 1); window.dispatchEvent(new Event('CART_UPDATED')); toast('Added to cart', 'success'); }
        catch (e) { toast(e.message || 'Could not add this product', 'error'); }
      }}>Add to cart</button>
    </article>)}</div>
  </section>;
}
