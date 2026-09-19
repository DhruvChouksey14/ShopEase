import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { catalogApi } from '../api/catalog.api';
import ProductGrid from '../components/product/ProductGrid';
import Spinner from '../components/ui/Spinner';

export default function HomePage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([catalogApi.getProducts({ limit: 8 }), catalogApi.getCategories()])
      .then(([productsRes, catRes]) => {
        setProducts(productsRes.data?.products || []);
        setCategories(catRes.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-12">
      <section className="bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-2xl px-8 py-16 text-white text-center">
        <h1 className="text-4xl font-extrabold tracking-tight">Everything you need, delivered fast.</h1>
        <p className="mt-3 text-indigo-100 max-w-xl mx-auto">Real-time stock, secure checkout, live order tracking — built on a fully event-driven microservices backend.</p>
        <Link to="/products" className="inline-block mt-6 px-6 py-3 bg-white text-indigo-700 font-semibold rounded-lg hover:bg-indigo-50 transition-colors">
          Shop now
        </Link>
      </section>

      {categories.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-slate-900 mb-4">Shop by Category</h2>
          <div className="flex flex-wrap gap-3">
            {categories.map((c) => (
              <Link
                key={c.id}
                to={`/products?categoryId=${c.id}`}
                className="px-4 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900">Featured Products</h2>
          <Link to="/products" className="text-sm font-medium text-indigo-600 hover:underline">View all</Link>
        </div>
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : (
          <ProductGrid products={products} />
        )}
      </section>
    </div>
  );
}
