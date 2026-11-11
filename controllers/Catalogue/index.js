// Routes for categories, products and stock. Routes only: the work is in catalogueHandler.js.
const express = require('express');

const catalogueHandler = require('./catalogueHandler');

const router = express.Router();

router.get('/categories', catalogueHandler.getCategories);
router.post('/categories', catalogueHandler.createCategory);
router.put('/categories/:categoryId', catalogueHandler.updateCategory);
router.post('/categories/:categoryId/move', catalogueHandler.moveCategory);

router.get('/products', catalogueHandler.getProducts);
router.get('/products/:productId', catalogueHandler.getProductById);
router.post('/products', catalogueHandler.createProduct);
router.put('/products/:productId', catalogueHandler.updateProduct);
router.put('/products/:productId/active', catalogueHandler.setProductActive);

router.post('/products/:productId/stock', catalogueHandler.adjustStock);
router.get('/products/:productId/stock-ledger', catalogueHandler.getStockLedger);

module.exports = router;
