import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { catalogApi } from '../api/catalog.api';
import { searchApi } from '../api/search.api';
import { useDebounce } from '../hooks/useDebounce';
import ProductGrid from '../components/product/ProductGrid';
import CategoryFilter from '../components/product/CategoryFilter';
import Input from '../components/ui/Input';

export default function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = searchParams.get('categoryId') || null;

  const [q, setQ] = useState(searchParams.get('q') || '');
  const debouncedQ = useDebounce(q, 400);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('');

  useEffect(() => {
    catalogApi.getCategories().then((res) => setCategories(res.data || []));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const isSearching = debouncedQ.trim().length > 0;
    const request = isSearching
      ? searchApi.searchProducts({ q: debouncedQ, categoryId: categoryId || undefined, sort: sort || undefined })
      : catalogApi.getProducts({ categoryId: categoryId || undefined, limit: 40 });

    request
      .then((res) => {
        const data = res.data;
        setProducts(isSearching ? data.products || [] : data.products || []);
      })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [debouncedQ, categoryId, sort]);

  useEffect(() => { load(); }, [load]);

  const onSelectCategory = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('categoryId', id); else next.delete('categoryId');
    setSearchParams(next);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Shop All Products</h1>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1">
          <Input placeholder="Search products (fuzzy search, powered by Elasticsearch)..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Relevance</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
          <option value="newest">Newest</option>
        </select>
      </div>

      <div className="mb-6">
        <CategoryFilter categories={categories} activeCategoryId={categoryId} onSelect={onSelectCategory} />
      </div>

      <ProductGrid products={products} isLoading={loading} />
    </div>
  );
}
