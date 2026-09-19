const { BadRequestError } = require('../utils/error');
const categoryService = require('../services/category.service');

exports.createCategory = async (req, res) => {
     const { name, description, imageUrl } = req.body;
     if (!name) throw new BadRequestError('name is required');
     const category = await categoryService.createCategory({ name, description, imageUrl });
     res.status(201).json({ success: true, message: 'Category created', data: category });
};

exports.updateCategory = async (req, res) => {
     const category = await categoryService.updateCategory(req.params.categoryId, req.body);
     res.status(200).json({ success: true, message: 'Category updated', data: category });
};

exports.getAllCategories = async (req, res) => {
     const categories = await categoryService.getAllCategories();
     res.status(200).json({ success: true, data: categories });
};

exports.getCategoryById = async (req, res) => {
     const category = await categoryService.getCategoryById(req.params.categoryId);
     res.status(200).json({ success: true, data: category });
};

exports.deleteCategory = async (req, res) => {
     await categoryService.deleteCategory(req.params.categoryId);
     res.status(200).json({ success: true, message: 'Category deleted' });
};
