import { useEffect, useState } from 'react';
import { catalogApi } from '../../api/catalog.api';
import { useToast } from '../ui/Toast';
import { formatCurrency } from '../../utils/format';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';

const emptyForm = { sku: '', name: '', description: '', price: '', categoryId: '', brand: '', images: '', initialStock: '' };

export default function ProductManager() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  const load = () => {
    catalogApi.getProducts({ limit: 50, includeInactive: true }).then((res) => setProducts(res.data?.products || []));
    catalogApi.getCategories().then((res) => setCategories(res.data || []));
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.categoryId) return showToast('Select a category', 'error');
    setSaving(true);
    try {
      await catalogApi.createProduct({
        ...form,
        price: parseFloat(form.price),
        initialStock: form.initialStock ? parseInt(form.initialStock, 10) : 0,
        images: form.images ? form.images.split(',').map((s) => s.trim()) : [],
      });
      setForm(emptyForm);
      load();
      showToast('Product created', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to create product', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await catalogApi.deleteProduct(id);
      load();
      showToast('Product deactivated', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to deactivate product', 'error');
    }
  };

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <form onSubmit={handleCreate} className="card p-4 space-y-3 h-fit">
        <h3 className="font-semibold text-slate-900">New Product</h3>
        <Input label="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Input label="Price (INR)" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
        <Select
          label="Category"
          value={form.categoryId}
          onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
          placeholder="Select category"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          required
        />
        <Input label="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        <Input label="Image URLs (comma separated)" value={form.images} onChange={(e) => setForm({ ...form, images: e.target.value })} />
        <Input label="Initial Stock" type="number" value={form.initialStock} onChange={(e) => setForm({ ...form, initialStock: e.target.value })} />
        <Button type="submit" loading={saving} className="w-full">Create Product</Button>
      </form>

      <div className="md:col-span-2 card p-4">
        <h3 className="font-semibold text-slate-900 mb-3">All Products ({products.length})</h3>
        <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
          {products.map((p) => (
            <div key={p.id} className="py-2.5 flex justify-between items-center gap-3">
              <div className="min-w-0">
                <p className={`font-medium truncate ${p.isActive ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{p.name}</p>
                <p className="text-xs text-slate-500">{p.sku} · {formatCurrency(p.price)} · {p.category?.name}</p>
              </div>
              {p.isActive && (
                <button onClick={() => handleDelete(p.id)} className="text-xs text-rose-600 hover:underline shrink-0">Deactivate</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
