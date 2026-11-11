// Data access for managing orders: runs the queries in sql.js and returns plain rows.
// Functions that take `tx` run inside the caller's transaction.
const { customQuery, multiQuery, inTransaction } = require('../../utils/dbFunctions');
const sql = require('./sql');

const run = (tx) => (tx ? tx.run : customQuery);

exports.withTransaction = inTransaction;

exports.getOrders = async (filters) => {
    return await customQuery(sql.GET_ORDERS(), { Q: filters.q, Status: filters.status, Payment: filters.payment, From: filters.from, To: filters.to });
};

exports.getOrderById = async (orderId) => {
    const [[order], items, history, payments, [invoice], [customer]] = await multiQuery(sql.GET_ORDER_BY_ID(), { Id: orderId });
    return { order, items, history, payments, invoice, customer };
};

exports.lockOrderById = async (tx, orderId) => {
    const [row] = await run(tx)(sql.LOCK_ORDER_BY_ID(), { Id: orderId });
    return row || null;
};

exports.updateOrderStatus = async (tx, orderId, status) => {
    return await run(tx)(sql.UPDATE_ORDER_STATUS(), { Id: orderId, Status: status });
};

exports.updateOrderShipping = async (tx, orderId, { courierName, trackingNo, trackingUrl }) => {
    return await run(tx)(sql.UPDATE_ORDER_SHIPPING(), { Id: orderId, CourierName: courierName, TrackingNo: trackingNo, TrackingUrl: trackingUrl });
};

exports.markOrderCancelled = async (tx, orderId, reason) => {
    return await run(tx)(sql.MARK_ORDER_CANCELLED(), { Id: orderId, Reason: reason });
};

exports.markOrderPaid = async (tx, orderId) => {
    return await run(tx)(sql.MARK_ORDER_PAID(), { Id: orderId });
};

exports.getOrderItems = async (tx, orderId) => {
    return await run(tx)(sql.GET_ORDER_ITEMS(), { Id: orderId });
};

exports.insertOrderHistory = async (tx, { orderId, status, note, adminId }) => {
    return await run(tx)(sql.INSERT_ORDER_HISTORY(), { Id: orderId, Status: status, Note: note || null, AdminId: adminId });
};

exports.getOrderPaidSoFar = async (tx, orderId) => {
    const [{ Paid }] = await run(tx)(sql.GET_ORDER_PAID_SO_FAR(), { Id: orderId });
    return Number(Paid);
};

exports.insertOrderPayment = async (tx, orderId, p) => {
    return await run(tx)(sql.INSERT_ORDER_PAYMENT(), { OrderId: orderId, Method: p.method, Amount: p.amount, Reference: p.reference, ReceivedOn: p.receivedOn, AdminId: p.adminId, Note: p.note });
};

exports.cancelOrderInvoices = async (tx, orderId) => {
    return await run(tx)(sql.CANCEL_ORDER_INVOICES(), { Id: orderId });
};
