import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCartStore } from '../store/cart.store';
import { useToast } from '../components/ui/Toast';
import CartItemRow from '../components/cart/CartItemRow';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Spinner from '../components/ui/Spinner';
import { formatCurrency } from '../utils/format';

export default function CartPage() {
  const { items, subtotal, isLoading, fetchCart, updateItem, removeItem } = useCartStore();
  const navigate = useNavigate();
  const showToast = useToast();

  useEffect(() => { fetchCart(); }, [fetchCart]);

  const handleUpdateQty = async (productId, quantity) => {
    try {
      await updateItem(productId, quantity);
    } catch (err) {
      showToast(err.message || 'Failed to update cart', 'error');
    }
  };

  const handleRemove = async (productId) => {
    try {
      await removeItem(productId);
      showToast('Item removed', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to remove item', 'error');
    }
  };

  if (isLoading) return <div className="flex justify-center py-24"><Spinner /></div>;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Your Cart</h1>

      {items.length === 0 ? (
        <EmptyState title="Your cart is empty" message="Browse our catalog and add something you like.">
          <Link to="/products"><Button>Start Shopping</Button></Link>
        </EmptyState>
      ) : (
        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 card p-4">
            {items.map((item) => (
              <CartItemRow key={item.productId} item={item} onUpdateQty={handleUpdateQty} onRemove={handleRemove} />
            ))}
          </div>

          <div className="card p-5 h-fit">
            <h2 className="font-semibold text-slate-900 mb-4">Order Summary</h2>
            <div className="flex justify-between text-sm text-slate-600 mb-2">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-600 mb-4">
              <span>Shipping</span>
              <span>Free</span>
            </div>
            <div className="flex justify-between font-bold text-slate-900 border-t border-slate-100 pt-3 mb-5">
              <span>Total</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <Button className="w-full" onClick={() => navigate('/checkout')}>Proceed to Checkout</Button>
          </div>
        </div>
      )}
    </div>
  );
}
