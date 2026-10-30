import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { aiApi } from '../../api/ai.api';
import { cartApi } from '../../api/cart.api';
import { useCartStore } from '../../store/cart.store';
import { useAuthStore } from '../../store/auth.store';
import { useToast } from '../ui/Toast';
import { formatCurrency } from '../../utils/format';

export default function ShoppingAssistant() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const endRef = useRef(null);
  const navigate = useNavigate();
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const fetchCart = useCartStore((s) => s.fetchCart);
  const toast = useToast();
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    const refresh = () => fetchCart();
    window.addEventListener('CART_UPDATED', refresh);
    return () => window.removeEventListener('CART_UPDATED', refresh);
  }, [fetchCart]);
  async function send(text = draft) {
    if (!authenticated) { setMessages((m) => [...m, { role: 'assistant', text: 'Sign in to chat with the shopping assistant.' }]); return; }
    const value = text.trim();
    if (!value || value.length > 1000 || busy) return;
    setDraft(''); setBusy(true);
    setMessages((m) => [...m, { role: 'user', text: value }]);
    try {
      const result = await aiApi.chat(value);
      setMessages((m) => [...m, { role: 'assistant', text: result.reply, products: result.products || [], actions: result.actions || [] }]);
    } catch (e) { setMessages((m) => [...m, { role: 'assistant', text: e.message || 'Assistant is unavailable right now.' }]); }
    finally { setBusy(false); }
  }
  async function checkout() {
    if (!useAuthStore.getState().isAuthenticated) { toast('Sign in before checkout', 'error'); return; }
    try {
      const cart = await cartApi.getCart();
      const data = cart.data || cart;
      if (!data.items?.length) { toast('Your cart is empty', 'error'); return; }
      navigate('/checkout');
    } catch (e) { toast(e.message || 'Could not check your cart', 'error'); }
  }
  return <div className="fixed bottom-5 right-5 z-50">
    {open && <section className="mb-3 w-[min(92vw,24rem)] h-[min(70vh,38rem)] bg-white border shadow-2xl rounded-2xl flex flex-col overflow-hidden" aria-label="Shopping assistant">
      <header className="bg-indigo-700 text-white p-4 flex justify-between"><strong>Shopping assistant</strong><button onClick={() => setOpen(false)} aria-label="Close">×</button></header>
      <div className="flex-1 overflow-auto p-3 space-y-3">{messages.map((m, i) => <div key={i} className={`text-sm ${m.role === 'user' ? 'text-right' : ''}`}>
        <p className="inline-block max-w-full rounded-xl bg-slate-100 p-3 whitespace-pre-wrap">{m.text}</p>
        {!!m.products?.length && <div className="mt-2 space-y-2">{m.products.map((p) => <article key={p.productId} className="border rounded-lg p-2 flex gap-2">
          {p.imageUrl && <img src={p.imageUrl} alt="" className="w-14 h-14 object-cover rounded" />}
          <div className="min-w-0 flex-1"><Link className="text-indigo-700 font-semibold" to={`/products/${encodeURIComponent(p.productId)}`} onClick={() => setOpen(false)}>{p.name}</Link>{Number.isFinite(p.price) && <p>{formatCurrency(p.price)}</p>}
            <button className="text-xs underline" onClick={async () => { if (!useAuthStore.getState().isAuthenticated) { toast('Sign in to add products to your cart', 'error'); return; } try { await useCartStore.getState().addItem(p.productId, 1); window.dispatchEvent(new Event('CART_UPDATED')); toast('Added to cart', 'success'); } catch (e) { toast(e.message || 'Could not add', 'error'); } }}>Add to cart</button>
          </div></article>)}</div>}
        {m.actions?.some((a) => a.type === 'go_to_checkout') && <button className="mt-2 px-3 py-2 bg-indigo-700 text-white rounded" onClick={checkout}>Check cart and go to checkout</button>}
      </div>)}{busy && <p className="text-sm text-slate-500">Thinking…</p>}<div ref={endRef} /></div>
      <form className="p-3 border-t flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}><input value={draft} maxLength={1000} onChange={(e) => setDraft(e.target.value)} className="flex-1 border rounded-lg px-3" placeholder="What are you looking for?" /><button disabled={busy || !draft.trim()} className="bg-indigo-700 text-white px-3 rounded-lg">Send</button></form>
    </section>}
    <button onClick={() => setOpen((v) => !v)} className="rounded-full shadow-lg bg-indigo-700 text-white px-5 py-3 font-semibold">{open ? 'Close' : 'Ask ShopEase'}</button>
  </div>;
}
