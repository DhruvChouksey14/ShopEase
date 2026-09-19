export default function EmptyState({ title = 'No results found', message, children }) {
  return (
    <div className="text-center py-16">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl">⌁</div>
      <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
      {message && <p className="text-sm text-slate-500 mt-1">{message}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
