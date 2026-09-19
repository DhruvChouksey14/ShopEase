const { Client } = require('@elastic/elasticsearch');
const { config } = require('.');

const esClient = new Client({ node: config.ELASTICSEARCH_URL });

const PRODUCT_INDEX = 'products';

/**
 * Product index mapping powers:
 *   • Fuzzy full-text search (name/description/brand, with fuzziness)
 *   • Autocomplete (edge-ngram analyzer on name)
 *   • Filtering (category, price range, in-stock) + sorting
 */
const initIndices = async () => {
     const exists = await esClient.indices.exists({ index: PRODUCT_INDEX });
     if (!exists) {
          await esClient.indices.create({
               index: PRODUCT_INDEX,
               settings: {
                    analysis: {
                         analyzer: {
                              autocomplete_analyzer: { type: 'custom', tokenizer: 'autocomplete_tokenizer', filter: ['lowercase'] },
                              search_analyzer: { type: 'custom', tokenizer: 'standard', filter: ['lowercase'] },
                         },
                         tokenizer: {
                              autocomplete_tokenizer: { type: 'edge_ngram', min_gram: 2, max_gram: 20, token_chars: ['letter', 'digit'] },
                         },
                    },
               },
               mappings: {
                    properties: {
                         productId: { type: 'keyword' },
                         sku: { type: 'keyword' },
                         name: { type: 'text', analyzer: 'autocomplete_analyzer', search_analyzer: 'search_analyzer' },
                         description: { type: 'text' },
                         brand: { type: 'text', analyzer: 'autocomplete_analyzer', search_analyzer: 'search_analyzer' },
                         categoryId: { type: 'keyword' },
                         categoryName: { type: 'text' },
                         price: { type: 'float' },
                         compareAtPrice: { type: 'float' },
                         images: { type: 'keyword' },
                         isActive: { type: 'boolean' },
                         inStock: { type: 'boolean' },
                         availableQuantity: { type: 'integer' },
                         createdAt: { type: 'date' },
                    },
               },
          });
          console.log('Product index created');
     }
};

const recreateIndices = async () => {
     const exists = await esClient.indices.exists({ index: PRODUCT_INDEX });
     if (exists) {
          await esClient.indices.delete({ index: PRODUCT_INDEX });
          console.log(`Deleted index: ${PRODUCT_INDEX}`);
     }
     await initIndices();
     console.log('All indices recreated');
};

module.exports = { esClient, PRODUCT_INDEX, initIndices, recreateIndices };
