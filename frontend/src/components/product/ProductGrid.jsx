import ProductCard from './ProductCard';
import EmptyState from '../ui/EmptyState';
import Spinner from '../ui/Spinner';

export default function ProductGrid({ products, isLoading }) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (!products || products.length === 0) {
    return <EmptyState title="No products found" message="Try adjusting your filters or search terms." />;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {products.map((p) => (
        <ProductCard key={p.productId || p.id} product={p} />
      ))}
    </div>
  );
}
