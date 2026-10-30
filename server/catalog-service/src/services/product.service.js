const prisma = require('../config/prisma');
const producer = require('../kafka/producer/catalog.producer');
const { slugify } = require('./category.service');
const { NotFoundError, ConflictError, BadRequestError } = require('../utils/error');
const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const presentProduct = (product) => product && ({ ...product, price: product.pricePaise / 100, compareAtPrice: product.compareAtPricePaise == null ? null : product.compareAtPricePaise / 100 });

const createProduct = async (data) => {
     const { sku, name, description, price, compareAtPrice, images, categoryId, brand, attributes, initialStock } = data;

     if (!sku || !name || price === undefined || !categoryId) {
          throw new BadRequestError('sku, name, price, and categoryId are required');
     }

     const category = await prisma.category.findUnique({ where: { id: categoryId } });
     if (!category) throw new NotFoundError('Category not found');

     const existingSku = await prisma.product.findUnique({ where: { sku } });
     if (existingSku) throw new ConflictError('A product with this SKU already exists');

     let slug = slugify(name);
     const slugTaken = await prisma.product.findUnique({ where: { slug } });
     if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;

     const product = await prisma.product.create({
          data: {
               sku,
               name,
               slug,
               description,
               pricePaise: toPaise(price),
               compareAtPricePaise: compareAtPrice == null ? null : toPaise(compareAtPrice),
               images: images || [],
               categoryId,
               brand,
               attributes: attributes || {},
          },
          include: { category: true },
     });

     try {
          // initialStock lets admins seed inventory in the same request; inventory-service
          // also self-heals by creating a zero-stock row on PRODUCT_CREATED if this is absent.
          await producer.publishProductCreated({ ...product, initialStock: initialStock ?? 0 });
     } catch (err) {
          console.error('Failed to publish PRODUCT_CREATED after retries — search/inventory may be stale', { error: err.message });
     }

     return presentProduct(product);
};

const updateProduct = async (productId, data) => {
     const product = await prisma.product.findUnique({ where: { id: productId } });
     if (!product) throw new NotFoundError('Product not found');

     if (data.categoryId) {
          const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
          if (!category) throw new NotFoundError('Category not found');
     }

     const updated = await prisma.product.update({
          where: { id: productId },
          data: {
               name: data.name ?? product.name,
               description: data.description ?? product.description,
               pricePaise: data.price !== undefined ? toPaise(data.price) : product.pricePaise,
               compareAtPricePaise: data.compareAtPrice !== undefined ? (data.compareAtPrice == null ? null : toPaise(data.compareAtPrice)) : product.compareAtPricePaise,
               images: data.images ?? product.images,
               categoryId: data.categoryId ?? product.categoryId,
               brand: data.brand ?? product.brand,
               attributes: data.attributes ?? product.attributes,
               isActive: data.isActive ?? product.isActive,
          },
          include: { category: true },
     });

     try {
          await producer.publishProductUpdated(updated);
     } catch (err) {
          console.error('Failed to publish PRODUCT_UPDATED after retries', { error: err.message });
     }

     return presentProduct(updated);
};

const deleteProduct = async (productId) => {
     const product = await prisma.product.findUnique({ where: { id: productId } });
     if (!product) throw new NotFoundError('Product not found');

     // Soft-delete: keep history intact for past orders, just hide from catalog/search.
     await prisma.product.update({ where: { id: productId }, data: { isActive: false } });

     try {
          await producer.publishProductDeleted(productId);
     } catch (err) {
          console.error('Failed to publish PRODUCT_DELETED after retries', { error: err.message });
     }
};

const getAllProducts = async ({ categoryId, page = 1, limit = 20, includeInactive = false } = {}) => {
     const skip = (page - 1) * limit;
     const where = {};
     if (categoryId) where.categoryId = categoryId;
     if (!includeInactive) where.isActive = true;

     const [products, total] = await Promise.all([
          prisma.product.findMany({ where, include: { category: true }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
          prisma.product.count({ where }),
     ]);

     return { products: products.map(presentProduct), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

const getProductById = async (productId) => {
     const product = await prisma.product.findUnique({ where: { id: productId }, include: { category: true } });
     if (!product) throw new NotFoundError('Product not found');
     return presentProduct(product);
};

const getProductsByIds = async (ids) => {
     return (await prisma.product.findMany({ where: { id: { in: ids } }, include: { category: true } })).map(presentProduct);
};

module.exports = { createProduct, updateProduct, deleteProduct, getAllProducts, getProductById, getProductsByIds };
