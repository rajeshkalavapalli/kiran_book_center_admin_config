// Data access for the dashboard and reports: runs the queries in sql.js and returns the result sets by name.
const { multiQuery } = require('../../utils/dbFunctions');
const sql = require('./sql');

exports.getDashboard = async () => {
    const [[kpis], lowStock, attention, recentOrders, daily, pipeline, [month], topProducts] = await multiQuery(sql.GET_DASHBOARD());
    return { kpis, lowStock, attention, recentOrders, daily, pipeline, month, topProducts };
};

exports.getReport = async (from, to) => {
    const [[totals], daily, [items], categories, topProducts, payments, gst, [invoices]] = await multiQuery(sql.GET_REPORT(), { From: from, To: to });
    return { totals, daily, items, categories, topProducts, payments, gst, invoices };
};
