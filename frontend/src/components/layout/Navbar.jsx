import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { useCartStore } from '../../store/cart.store';

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const { items, fetchCart } = useCartStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) fetchCart();
  }, [isAuthenticated, fetchCart]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <nav className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 text-slate-900 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <span className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-black text-white">SE</span>
            <span>ShopEase</span>
          </Link>

          <div className="flex items-center gap-1 sm:gap-2">
            <Link to="/products" className="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 transition-colors">
              Shop
            </Link>

            <Link to="/cart" className="relative px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 transition-colors">
              Cart
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center">
                  {itemCount}
                </span>
              )}
            </Link>

            {isAuthenticated ? (
              <>
                <Link to="/orders" className="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 transition-colors">
                  My Orders
                </Link>
                {user?.role === 'ADMIN' && (
                  <Link to="/admin" className="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950 transition-colors">
                    Admin
                  </Link>
                )}
                <div className="flex items-center gap-2 ml-2 pl-2 border-l border-slate-200">
                  <span className="text-sm hidden sm:inline text-slate-500">{user?.firstName}</span>
                  <button
                    onClick={handleLogout}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Logout
                  </button>
                </div>
              </>
            ) : (
              <Link to="/login" className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
