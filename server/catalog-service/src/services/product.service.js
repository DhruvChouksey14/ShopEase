const prisma = require('../config/prisma');
const producer = require('../kafka/producer/catalog.producer');
const { slugify } = require('./category.service');
const { NotFoundError, ConflictError, BadRequestError } = require('../utils/error');

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
               price,
               compareAtPrice: compareAtPrice || null,
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

     return product;
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
               price: data.price ?? product.price,
               compareAtPrice: data.compareAtPrice ?? product.compareAtPrice,
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

     return updated;
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

     return { products, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

const getProductById = async (productId) => {
     const product = await prisma.product.findUnique({ where: { id: productId }, include: { category: true } });
     if (!product) throw new NotFoundError('Product not found');
     return product;
};

const getProductsByIds = async (ids) => {
     return prisma.product.findMany({ where: { id: { in: ids } }, include: { category: true } });
};

module.exports = { createProduct, updateProduct, deleteProduct, getAllProducts, getProductById, getProductsByIds };
