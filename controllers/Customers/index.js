// Routes for customers. Routes only: the work is in customerHandler.js.
const express = require('express');

const customerHandler = require('./customerHandler');

const router = express.Router();

router.get('/customers', customerHandler.getCustomers);
router.get('/customers/:customerId', customerHandler.getCustomerById);
router.post('/customers/:customerId/reset-password', customerHandler.resetCustomerPassword);
router.put('/customers/:customerId/active', customerHandler.setCustomerActive);

module.exports = router;
