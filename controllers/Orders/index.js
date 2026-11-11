// Routes for managing orders. Routes only: the work is in orderHandler.js.
const express = require('express');

const orderHandler = require('./orderHandler');

const router = express.Router();

router.get('/orders', orderHandler.getOrders);
router.get('/orders/:orderId', orderHandler.getOrderById);
router.post('/orders/:orderId/advance', orderHandler.advanceOrder);
router.post('/orders/:orderId/cancel', orderHandler.cancelOrder);
router.post('/orders/:orderId/payments', orderHandler.recordOrderPayment);
router.post('/orders/:orderId/invoice', orderHandler.issueOrderInvoice);

module.exports = router;
