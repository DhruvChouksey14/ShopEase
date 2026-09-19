const prisma = require('../config/prisma');
const producer = require('../kafka/producer/catalog.producer');
const { NotFoundError, ConflictError } = require('../utils/error');

const slugify = (text) =>
     text.toString().toLowerCase().trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '');

const createCategory = async ({ name, description, imageUrl }) => {
     const slug = slugify(name);
     const existing = await prisma.category.findFirst({ where: { OR: [{ name }, { slug }] } });
     if (existing) throw new ConflictError('Category with this name already exists');

     const category = await prisma.category.create({
          data: { name, slug, description, imageUrl },
     });

     try {
          await producer.publishCategoryCreated(category);
     } catch (err) {
          console.error('Failed to publish CATEGORY_CREATED after retries — search index may be stale', { error: err.message });
     }

     return category;
};

const updateCategory = async (categoryId, data) => {
     const category = await prisma.category.findUnique({ where: { id: categoryId } });
     if (!category) throw new NotFoundError('Category not found');

     const updated = await prisma.category.update({
          where: { id: categoryId },
          data: {
               name: data.name ?? category.name,
               slug: data.name ? slugify(data.name) : category.slug,
               description: data.description ?? category.description,
               imageUrl: data.imageUrl ?? category.imageUrl,
          },
     });

     try {
          await producer.publishCategoryUpdated(updated);
     } catch (err) {
          console.error('Failed to publish CATEGORY_UPDATED after retries', { error: err.message });
     }

     return updated;
};

const getAllCategories = async () => prisma.category.findMany({ orderBy: { name: 'asc' } });

const getCategoryById = async (categoryId) => {
     const category = await prisma.category.findUnique({ where: { id: categoryId } });
     if (!category) throw new NotFoundError('Category not found');
     return category;
};

const deleteCategory = async (categoryId) => {
     const productCount = await prisma.product.count({ where: { categoryId } });
     if (productCount > 0) {
          throw new ConflictError('Cannot delete a category that still has products');
     }
     await prisma.category.delete({ where: { id: categoryId } });
};

module.exports = { createCategory, updateCategory, getAllCategories, getCategoryById, deleteCategory, slugify };
