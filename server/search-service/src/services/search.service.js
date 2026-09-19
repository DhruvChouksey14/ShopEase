const { esClient, PRODUCT_INDEX } = require('../config/elasticsearch');

// ─── Indexing (called from Kafka consumer) ───────────────────────────────────

const indexProduct = async (product) => {
     await esClient.index({
          index: PRODUCT_INDEX,
          id: product.id,
          document: {
               productId: product.id,
               sku: product.sku,
               name: product.name,
               description: product.description || '',
               brand: product.brand || '',
               categoryId: product.categoryId,
               categoryName: product.category?.name || '',
               price: product.price,
               compareAtPrice: product.compareAtPrice || null,
               images: product.images || [],
               isActive: product.isActive !== false,
               inStock: true, // corrected shortly after by a STOCK_UPDATED event
               availableQuantity: 0,
               createdAt: product.createdAt || new Date().toISOString(),
          },
     });
};

const removeProduct = async (productId) => {
     try {
          await esClient.delete({ index: PRODUCT_INDEX, id: productId });
     } catch (err) {
          if (err.meta?.statusCode !== 404) throw err;
     }
};

const updateStockFields = async (productId, available) => {
     try {
          await esClient.update({
               index: PRODUCT_INDEX,
               id: productId,
               doc: { inStock: available > 0, availableQuantity: available },
          });
     } catch (err) {
          if (err.meta?.statusCode !== 404) throw err;
          console.warn(`Stock update for unindexed product ${productId} ignored`);
     }
};

// ─── Search / Autocomplete ────────────────────────────────────────────────────

const searchProducts = async ({ q, categoryId, minPrice, maxPrice, inStockOnly, sort, page = 1, limit = 20 }) => {
     const must = [];
     const filter = [{ term: { isActive: true } }];

     if (q) {
          must.push({
               multi_match: {
                    query: q,
                    fields: ['name^3', 'brand^2', 'description'],
                    fuzziness: 'AUTO',
               },
          });
     }
     if (categoryId) filter.push({ term: { categoryId } });
     if (inStockOnly === true) filter.push({ term: { inStock: true } });
     if (minPrice !== undefined || maxPrice !== undefined) {
          const range = {};
          if (minPrice !== undefined) range.gte = minPrice;
          if (maxPrice !== undefined) range.lte = maxPrice;
          filter.push({ range: { price: range } });
     }

     const sortClause =
          sort === 'price_asc' ? [{ price: 'asc' }] :
          sort === 'price_desc' ? [{ price: 'desc' }] :
          sort === 'newest' ? [{ createdAt: 'desc' }] :
          undefined; // default: relevance score

     const result = await esClient.search({
          index: PRODUCT_INDEX,
          query: { bool: { must: must.length ? must : [{ match_all: {} }], filter } },
          sort: sortClause,
          from: (page - 1) * limit,
          size: limit,
     });

     return {
          products: result.hits.hits.map((h) => ({ ...h._source, score: h._score })),
          total: typeof result.hits.total === 'object' ? result.hits.total.value : result.hits.total,
          page,
          limit,
     };
};

const autocomplete = async (q) => {
     const result = await esClient.search({
          index: PRODUCT_INDEX,
          query: {
               bool: {
                    must: [{ match: { name: { query: q, analyzer: 'search_analyzer' } } }],
                    filter: [{ term: { isActive: true } }],
               },
          },
          size: 8,
          _source: ['productId', 'name', 'images', 'price'],
     });
     return result.hits.hits.map((h) => h._source);
};

module.exports = { indexProduct, removeProduct, updateStockFields, searchProducts, autocomplete };
