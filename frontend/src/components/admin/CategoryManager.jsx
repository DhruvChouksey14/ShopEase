import { useEffect, useState } from 'react';
import { catalogApi } from '../../api/catalog.api';
import { useToast } from '../ui/Toast';
import Input from '../ui/Input';
import Button from '../ui/Button';

export default function CategoryManager() {
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  const load = () => catalogApi.getCategories().then((res) => setCategories(res.data || []));
  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await catalogApi.createCategory(form);
      setForm({ name: '', description: '' });
      await load();
      showToast('Category created', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to create category', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <form onSubmit={handleCreate} className="card p-4 space-y-3 h-fit">
        <h3 className="font-semibold text-slate-900">New Category</h3>
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Button type="submit" loading={saving} className="w-full">Create</Button>
      </form>

      <div className="md:col-span-2 card p-4">
        <h3 className="font-semibold text-slate-900 mb-3">All Categories ({categories.length})</h3>
        <div className="divide-y divide-slate-100">
          {categories.map((c) => (
            <div key={c.id} className="py-2.5 flex justify-between items-center">
              <div>
                <p className="font-medium text-slate-800">{c.name}</p>
                <p className="text-xs text-slate-500">{c.description}</p>
              </div>
              <span className="text-xs text-slate-400 font-mono">{c.id.slice(0, 8)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
