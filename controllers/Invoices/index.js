// Routes for GST invoices. Routes only: the work is in invoiceHandler.js.
const express = require('express');

const invoiceHandler = require('./invoiceHandler');

const router = express.Router();

router.get('/invoices', invoiceHandler.getInvoices);
router.get('/invoice-years', invoiceHandler.getInvoiceYears);
router.get('/invoices/:invoiceId', invoiceHandler.getInvoiceById);

module.exports = router;
