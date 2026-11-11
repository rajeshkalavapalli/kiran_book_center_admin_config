// Data access for managing requests: runs the queries in sql.js and returns plain rows.
// Functions that take `tx` run inside the caller's transaction.
const { customQuery, multiQuery, inTransaction } = require('../../utils/dbFunctions');
const sql = require('./sql');

const run = (tx) => (tx ? tx.run : customQuery);

exports.withTransaction = inTransaction;

exports.getRequests = async (filters) => {
    return await customQuery(sql.GET_REQUESTS(), { Q: filters.q, Status: filters.status, Type: filters.type });
};

exports.getRequestById = async (requestId) => {
    const [[request], items, history, payments, [invoice], [customer], attachments] = await multiQuery(sql.GET_REQUEST_BY_ID(), { Id: requestId });
    return { request, items, history, payments, invoice, customer, attachments };
};

exports.lockRequestById = async (tx, requestId) => {
    const [row] = await run(tx)(sql.LOCK_REQUEST_BY_ID(), { Id: requestId });
    return row || null;
};

exports.getRequestItems = async (tx, requestId) => {
    return await run(tx)(sql.GET_REQUEST_ITEMS(), { Id: requestId });
};

exports.updateRequestItemQuote = async (tx, requestId, line) => {
    return await run(tx)(sql.UPDATE_REQUEST_ITEM_QUOTE(), {
        Id: requestId,
        LineNumber: line.lineNumber,
        IsAvailable: line.isAvailable,
        Price: line.price,
        GstPercent: line.gstPercent,
        HsnCode: line.hsnCode,
    });
};

exports.updateRequestQuote = async (tx, requestId, q) => {
    return await run(tx)(sql.UPDATE_REQUEST_QUOTE(), { Id: requestId, ItemsTotal: q.itemsTotal, Shipping: q.shipping, Total: q.total, ValidUntil: q.validUntil, Note: q.note });
};

exports.updateRequestStatus = async (tx, requestId, status) => {
    return await run(tx)(sql.UPDATE_REQUEST_STATUS(), { Id: requestId, Status: status });
};

exports.markRequestRejected = async (tx, requestId, reason) => {
    return await run(tx)(sql.MARK_REQUEST_REJECTED(), { Id: requestId, Reason: reason });
};

exports.markRequestPaid = async (tx, requestId) => {
    return await run(tx)(sql.MARK_REQUEST_PAID(), { Id: requestId });
};

exports.updateRequestShipping = async (tx, requestId, { courierName, trackingNo, trackingUrl }) => {
    return await run(tx)(sql.UPDATE_REQUEST_SHIPPING(), { Id: requestId, CourierName: courierName, TrackingNo: trackingNo, TrackingUrl: trackingUrl });
};

exports.insertRequestHistory = async (tx, { requestId, status, note, adminId }) => {
    return await run(tx)(sql.INSERT_REQUEST_HISTORY(), { Id: requestId, Status: status, Note: note || null, AdminId: adminId });
};

exports.getRequestPaidSoFar = async (tx, requestId) => {
    const [{ Paid }] = await run(tx)(sql.GET_REQUEST_PAID_SO_FAR(), { Id: requestId });
    return Number(Paid);
};

exports.insertRequestPayment = async (tx, requestId, p) => {
    return await run(tx)(sql.INSERT_REQUEST_PAYMENT(), { Id: requestId, Method: p.method, Amount: p.amount, Reference: p.reference, ReceivedOn: p.receivedOn, AdminId: p.adminId, Note: p.note });
};

exports.getRequestAttachment = async (requestId, attachmentId) => {
    const [row] = await customQuery(sql.GET_REQUEST_ATTACHMENT(), { Id: requestId, AttachmentId: attachmentId });
    return row || null;
};
