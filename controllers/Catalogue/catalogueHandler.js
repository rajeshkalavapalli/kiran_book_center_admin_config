// HTTP side of categories, products and stock.
// Each handler: read what the admin panel sent → call ONE service function → send the result.
// Errors: a service error with `status` (from fail()) is a message for the owner; anything else is logged and becomes a 500.
// Product saves can also send `errors` (field → message) so the editor can highlight the fields.
const catalogueService = require('./catalogueService');

/* ---------------- categories ---------------- */

exports.getCategories = async (req, res) => {
    try {
        const result = await catalogueService.getCategories();
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the categories', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load categories.' });
    }
};

exports.createCategory = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const categoryData = req.body || {};
        const result = await catalogueService.createCategory(adminId, categoryData);
        return res.status(201).json(result);
    } catch (err) {
        if (!err.status) console.log('error while adding the category', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to add the category.' });
    }
};

exports.updateCategory = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { categoryId } = req.params;
        const categoryData = req.body || {};
        const result = await catalogueService.updateCategory(adminId, categoryId, categoryData);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while saving the category', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to save the category.' });
    }
};

exports.moveCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const dir = req.body?.dir;
        const result = await catalogueService.moveCategory(categoryId, dir);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while moving the category', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to move the category.' });
    }
};

/* ---------------- products ---------------- */

exports.getProducts = async (req, res) => {
    try {
        const filters = req.query;
        const result = await catalogueService.getProducts(filters);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the products', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load products.' });
    }
};

exports.getProductById = async (req, res) => {
    try {
        const { productId } = req.params;
        const result = await catalogueService.getProductById(productId);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the product', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load the product.' });
    }
};

exports.createProduct = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const productData = req.body || {};
        const result = await catalogueService.createProduct(adminId, productData);
        return res.status(201).json(result);
    } catch (err) {
        if (!err.status) console.log('error while adding the product', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to add the product.', ...(err.errors ? { errors: err.errors } : {}) });
    }
};

exports.updateProduct = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { productId } = req.params;
        const productData = req.body || {};
        const result = await catalogueService.updateProduct(adminId, productId, productData);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while saving the product', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to save the product.', ...(err.errors ? { errors: err.errors } : {}) });
    }
};

exports.setProductActive = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { productId } = req.params;
        const active = req.body?.active;
        const result = await catalogueService.setProductActive(adminId, productId, active);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while showing or hiding the product', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to show or hide the product.' });
    }
};

/* ---------------- stock ---------------- */

exports.adjustStock = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { productId } = req.params;
        const { change, reason, note } = req.body || {};
        const result = await catalogueService.adjustStock(adminId, productId, change, reason, note);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while adjusting the stock', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to adjust stock.' });
    }
};

exports.getStockLedger = async (req, res) => {
    try {
        const { productId } = req.params;
        const result = await catalogueService.getStockLedger(productId);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the stock history', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load stock history.' });
    }
};
