import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useCartStore } from '../store/cart.store';
import { useAuthStore } from '../store/auth.store';
import { orderApi } from '../api/order.api';
import { useToast } from '../components/ui/Toast';
import { loadRazorpayScript, openRazorpayCheckout } from '../utils/razorpay';
import { formatCurrency } from '../utils/format';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';

export default function CheckoutPage() {
  const { items, subtotal, fetchCart, clearLocal } = useCartStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const showToast = useToast();

  const [address, setAddress] = useState({ line1: '', line2: '', city: '', state: '', postalCode: '', country: 'India', phone: '' });
  const [placing, setPlacing] = useState(false);
  const [idempotencyKey] = useState(() => uuidv4());

  useEffect(() => { fetchCart(); }, [fetchCart]);

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    if (!address.line1 || !address.city || !address.postalCode) {
      showToast('Please fill in all required address fields', 'error');
      return;
    }
    setPlacing(true);
    try {
      const res = await orderApi.createOrder(address, idempotencyKey);
      const { orderId, paymentOrder } = res.data;

      await loadRazorpayScript();

      openRazorpayCheckout({
        keyId: paymentOrder.keyId,
        orderId: paymentOrder.gatewayOrderId,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
        orderDescription: `Order #${orderId.slice(0, 8)}`,
        user,
        onSuccess: async (response) => {
          try {
            await orderApi.verifyPayment(orderId, response.razorpay_payment_id, response.razorpay_signature);
            clearLocal();
            showToast('Payment successful! Your order is confirmed.', 'success');
            navigate(`/orders/${orderId}`);
          } catch (err) {
            showToast(err.message || 'Payment verification failed', 'error');
            navigate(`/orders/${orderId}`);
          }
        },
        onDismiss: () => {
          showToast('Payment cancelled. You can retry from your order history.', 'info');
          navigate(`/orders/${orderId}`);
        },
        onFailure: () => {
          showToast('Payment failed. Please try again.', 'error');
          navigate(`/orders/${orderId}`);
        },
      });
    } catch (err) {
      showToast(err.message || 'Failed to place order', 'error');
    } finally {
      setPlacing(false);
    }
  };

  if (items.length === 0) {
    return <div className="text-center py-24 text-slate-500">Your cart is empty. <a href="/products" className="text-indigo-600 underline">Go shopping</a></div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 grid md:grid-cols-3 gap-8">
      <form onSubmit={handlePlaceOrder} className="md:col-span-2 card p-6 space-y-4">
        <h1 className="text-xl font-bold text-slate-900 mb-2">Shipping Address</h1>
        <Input label="Address line 1" value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} required />
        <Input label="Address line 2 (optional)" value={address.line2} onChange={(e) => setAddress({ ...address, line2: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="City" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} required />
          <Input label="State" value={address.state} onChange={(e) => setAddress({ ...address, state: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Postal Code" value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} required />
          <Input label="Country" value={address.country} onChange={(e) => setAddress({ ...address, country: e.target.value })} required />
        </div>
        <Input label="Phone" value={address.phone} onChange={(e) => setAddress({ ...address, phone: e.target.value })} />

        <Button type="submit" loading={placing} className="w-full mt-4">
          {placing ? 'Processing...' : `Pay ${formatCurrency(subtotal)} with Razorpay`}
        </Button>
        <p className="text-xs text-slate-400 text-center">Secure checkout — payment details never touch our servers.</p>
      </form>

      <div className="card p-5 h-fit">
        <h2 className="font-semibold text-slate-900 mb-4">Order Summary</h2>
        {items.map((item) => (
          <div key={item.productId} className="flex justify-between text-sm text-slate-600 mb-2">
            <span className="truncate pr-2">{item.name} × {item.quantity}</span>
            <span className="shrink-0">{formatCurrency(item.lineTotal)}</span>
          </div>
        ))}
        <div className="flex justify-between font-bold text-slate-900 border-t border-slate-100 pt-3 mt-3">
          <span>Total</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>
      </div>
    </div>
  );
}
