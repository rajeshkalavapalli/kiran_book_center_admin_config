// HTTP side of GST invoices.
// Each handler: read what the admin panel sent → call ONE service function → send the result.
// Errors: a service error with `status` (from fail()) is a message for the owner; anything else is logged and becomes a 500.
const invoiceService = require('./invoiceService');

exports.getInvoices = async (req, res) => {
    try {
        const { fy } = req.query;
        const result = await invoiceService.getInvoices(fy);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the invoices', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load invoices.' });
    }
};

exports.getInvoiceYears = async (req, res) => {
    try {
        const result = await invoiceService.getInvoiceYears();
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the financial years', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load financial years.' });
    }
};

exports.getInvoiceById = async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const result = await invoiceService.getInvoiceById(invoiceId);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the invoice', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load the invoice.' });
    }
};
