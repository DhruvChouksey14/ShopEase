export default function AdminTabs({ tab, setTab }) {
  const tabs = [
    { id: 'products', label: 'Products' },
    { id: 'categories', label: 'Categories' },
    { id: 'orders', label: 'Orders' },
  ];
  return (
    <div className="flex border-b border-slate-200 mb-6">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
            tab === t.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
