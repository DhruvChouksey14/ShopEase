import { useState } from 'react';
import AdminTabs from '../components/admin/AdminTabs';
import CategoryManager from '../components/admin/CategoryManager';
import ProductManager from '../components/admin/ProductManager';
import OrderManager from '../components/admin/OrderManager';

export default function AdminPage() {
  const [tab, setTab] = useState('products');

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Admin Dashboard</h1>
      <AdminTabs tab={tab} setTab={setTab} />
      {tab === 'products' && <ProductManager />}
      {tab === 'categories' && <CategoryManager />}
      {tab === 'orders' && <OrderManager />}
    </div>
  );
}
