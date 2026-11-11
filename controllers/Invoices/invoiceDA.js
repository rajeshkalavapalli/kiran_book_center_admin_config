// Data access for GST invoices: runs the queries in sql.js and returns plain rows.
const { customQuery, multiQuery } = require('../../utils/dbFunctions');
const sql = require('./sql');

exports.getInvoices = async (financialYear) => {
    return await customQuery(sql.GET_INVOICES(), { FY: financialYear });
};

exports.getInvoiceYears = async () => {
    return await customQuery(sql.GET_INVOICE_YEARS());
};

exports.getInvoiceById = async (invoiceId) => {
    const [[invoice], lines] = await multiQuery(sql.GET_INVOICE_BY_ID(), { Id: invoiceId });
    return { invoice, lines };
};
