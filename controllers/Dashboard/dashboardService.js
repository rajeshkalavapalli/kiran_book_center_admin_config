// Business rules for the dashboard and reports: date ranges, filling in days without sales, rounding money.
// No SQL and no req/res here: the database goes through dashboardDA.js, the HTTP side is dashboardHandler.js.
// Each exported function: try → do the work → return the result; catch → log unexpected errors → throw to the handler.
const { fail, money } = require('../../utils/access');
const dashboardDA = require('./dashboardDA');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REPORT_DAYS = 400;

/* ---------------- helpers ---------------- */

// One entry per day in the list of dates, with 0 for days without sales.
const fillDays = (dates, daily) => {
    const byDay = Object.fromEntries(daily.map((d) => [d.date, d]));
    return dates.map((date) => ({ date, orders: byDay[date]?.orders || 0, total: money(byDay[date]?.total || 0) }));
};

// The last 14 India dates, oldest first.
const last14Days = () => {
    const todayIst = new Date(Date.now() + 5.5 * 3600000);
    const dates = [];
    for (let i = 13; i >= 0; i -= 1) dates.push(new Date(todayIst.getTime() - i * 86400000).toISOString().slice(0, 10));
    return dates;
};

// Every date from `from` to `to` (both included).
const datesBetween = (from, to) => {
    const dates = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
    return dates;
};

const withMoneyTotal = (rows) => rows.map((r) => ({ ...r, total: money(r.total) }));

/* ---------------- service functions (called by dashboardHandler.js) ---------------- */

exports.getDashboard = async () => {
    try {
        const { kpis, lowStock, attention, recentOrders, daily, pipeline, month, topProducts } = await dashboardDA.getDashboard();
        const result = {
            days: fillDays(last14Days(), daily),
            pipeline: Object.fromEntries(pipeline.map((r) => [r.Status, r.N])),
            ordersThisMonth: month.OrdersThisMonth,
            ordersLastMonthToDate: month.OrdersLastMonthToDate,
            avgOrderThisMonth: money(month.AvgThisMonth || 0),
            avgOrderLastMonth: money(month.AvgLastMonth || 0),
            pendingAmount: money(month.PendingAmount),
            topProducts: withMoneyTotal(topProducts),
            todayOrders: kpis.TodayOrders,
            toConfirm: kpis.ToConfirm,
            paymentsPending: kpis.PaymentsPending,
            newRequests: kpis.NewRequests,
            salesThisMonth: money(kpis.SalesThisMonth),
            salesLastMonthToDate: money(kpis.SalesLastMonthToDate),
            lowStock,
            attention: attention.map((a) => ({ ...a, on: a.onDate })),
            recentOrders,
        };
        return result;
    } catch (err) {
        if (!err.status) console.log('error in dashboardService.getDashboard', err);
        throw err;
    }
};

// Reports page for a date range (up to about a year): sales, daily series, categories, best sellers, payments, GST.
exports.getReport = async (from, to) => {
    try {
        if (!DATE.test(String(from)) || !DATE.test(String(to)) || from > to) throw fail(400, 'Choose a valid date range.');
        if ((new Date(to) - new Date(from)) / 86400000 > MAX_REPORT_DAYS) throw fail(400, 'Choose a range of up to about a year.');
        const { totals, daily, items, categories, topProducts, payments, gst, invoices } = await dashboardDA.getReport(from, to);
        const sales = money(totals.Sales);
        const result = {
            sales,
            orderCount: totals.OrderCount,
            avgOrder: totals.OrderCount ? money(sales / totals.OrderCount) : 0,
            itemsSold: items.ItemsSold,
            savingsGiven: money(totals.SavingsGiven),
            days: fillDays(datesBetween(from, to), daily),
            categories: withMoneyTotal(categories),
            topProducts: withMoneyTotal(topProducts),
            payments: withMoneyTotal(payments),
            gst: gst.map((g) => ({ rate: Number(g.rate), taxable: money(g.taxable), cgst: money(g.cgst), sgst: money(g.sgst), igst: money(g.igst), total: money(g.total) })),
            invoiceCount: invoices.InvoiceCount,
        };
        return result;
    } catch (err) {
        if (!err.status) console.log('error in dashboardService.getReport', err);
        throw err;
    }
};
