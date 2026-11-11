// Business rules for GST invoices (read-only here; invoices are issued from Orders and Requests).
// No SQL and no req/res here: the database goes through invoiceDA.js, the HTTP side is invoiceHandler.js.
// Each exported function: try → do the work → return the result; catch → log unexpected errors → throw to the handler.
const { fail, needGuid } = require('../../utils/access');
const invoiceDA = require('./invoiceDA');

const FINANCIAL_YEAR = /^\d{2}-\d{2}$/;

// All invoices, or only one financial year (e.g. "26-27").
exports.getInvoices = async (financialYear) => {
    try {
        const fy = FINANCIAL_YEAR.test(String(financialYear || '')) ? financialYear : null;
        const result = await invoiceDA.getInvoices(fy);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in invoiceService.getInvoices', err);
        throw err;
    }
};

// Financial years that have invoices, newest first, e.g. ["26-27", "25-26"].
exports.getInvoiceYears = async () => {
    try {
        const rows = await invoiceDA.getInvoiceYears();
        const result = rows.map((r) => r.FinancialYear);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in invoiceService.getInvoiceYears', err);
        throw err;
    }
};

// One invoice with its lines.
exports.getInvoiceById = async (invoiceId) => {
    try {
        const { invoice, lines } = await invoiceDA.getInvoiceById(needGuid(invoiceId, 'invoice'));
        if (!invoice) throw fail(404, 'That invoice was not found.');
        const result = { ...invoice, Lines: lines };
        return result;
    } catch (err) {
        if (!err.status) console.log('error in invoiceService.getInvoiceById', err);
        throw err;
    }
};
