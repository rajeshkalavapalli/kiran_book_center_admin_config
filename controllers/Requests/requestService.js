// Business rules for book requests and bulk enquiries: review, quoting (prices, GST, HSN per line),
// rejecting, payments (full payment issues the GST invoice), dispatch/pickup steps and attachments.
// No SQL and no req/res here: the database goes through requestDA.js, the HTTP side is requestHandler.js.
// Each exported function: try → do the work → return the result; catch → log unexpected errors → throw to the handler.
const { fail, needGuid, text, money } = require('../../utils/access');
const { audit, issueInvoice } = require('../../utils/shop');
const fileStore = require('../../utils/fileStore');
const { cleanPayment } = require('../Orders/orderService');
const requestDA = require('./requestDA');

const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'QUOTED', 'PAID', 'DISPATCHED', 'DELIVERED', 'READY_FOR_PICKUP', 'PICKED_UP', 'REJECTED', 'CANCELLED'];
const NEXT = {
    DELIVERY: { PAID: 'DISPATCHED', DISPATCHED: 'DELIVERED' },
    PICKUP: { PAID: 'READY_FOR_PICKUP', READY_FOR_PICKUP: 'PICKED_UP' },
};
const CAN_QUOTE_OR_REJECT = ['SUBMITTED', 'UNDER_REVIEW', 'QUOTED'];
const GST_RATES = [0, 5, 12, 18, 28];

/* ---------------- helpers ---------------- */

const likePattern = (q) => {
    const t = text(q, 100);
    return t ? `%${t.replace(/[%_[]/g, '[$&]')}%` : null;
};

const lockedRequest = async (tx, id) => {
    const r = await requestDA.lockRequestById(tx, id);
    if (!r) throw fail(404, 'That request was not found.');
    return r;
};

/* ---------------- service functions (called by requestHandler.js) ---------------- */

// Request list with optional filters: q, status (or OPEN), type (SINGLE|BULK).
exports.getRequests = async (query) => {
    try {
        const q = query || {};
        const result = await requestDA.getRequests({
            q: likePattern(q.q),
            status: q.status === 'OPEN' || STATUSES.includes(q.status) ? q.status : null,
            type: ['SINGLE', 'BULK'].includes(q.type) ? q.type : null,
        });
        return result;
    } catch (err) {
        if (!err.status) console.log('error in requestService.getRequests', err);
        throw err;
    }
};

// One request with lines, history, payments, invoice, customer and attachments.
exports.getRequestById = async (requestId) => {
    try {
        const { request, items, history, payments, invoice, customer, attachments } = await requestDA.getRequestById(needGuid(requestId, 'request'));
        if (!request) throw fail(404, 'That request was not found.');
        const result = { ...request, Items: items, History: history, Payments: payments, Invoice: invoice || null, Customer: customer || null, Attachments: attachments };
        return result;
    } catch (err) {
        if (!err.status) console.log('error in requestService.getRequestById', err);
        throw err;
    }
};

// Marks a new request as "under review" (does nothing if it's already past that).
exports.startReview = async (adminId, requestId) => {
    try {
        const id = needGuid(requestId, 'request');
        await requestDA.withTransaction(async (tx) => {
            const r = await lockedRequest(tx, id);
            if (r.Status !== 'SUBMITTED') return;
            await requestDA.updateRequestStatus(tx, id, 'UNDER_REVIEW');
            await requestDA.insertRequestHistory(tx, { requestId: id, status: 'UNDER_REVIEW', adminId });
        });
        const result = await exports.getRequestById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in requestService.startReview', err);
        throw err;
    }
};

/**
 * Sends (or updates) the quote.
 * quoteData: { lines: [{ LineNumber, QuotedUnitPrice, GstPercent, HsnCode, IsAvailable }], shipping, validUntil, note }
 */
exports.sendQuote = async (adminId, requestId, quoteData) => {
    try {
        const id = needGuid(requestId, 'request');
        const { lines = [], shipping, validUntil, note } = quoteData || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(validUntil || ''))) throw fail(400, 'Choose until when the quote is valid.');
        if (validUntil < new Date().toISOString().slice(0, 10)) throw fail(400, 'The valid-until date is in the past.');
        const ship = money(shipping);
        if (ship < 0) throw fail(400, 'Delivery charge must be 0 or more.');
        let total = 0;
        await requestDA.withTransaction(async (tx) => {
            const r = await lockedRequest(tx, id);
            if (!CAN_QUOTE_OR_REJECT.includes(r.Status)) throw fail(409, "This request can't be quoted now.");
            if (r.AcceptedOn) throw fail(409, 'The customer already accepted this quote. Record the payment instead.');
            const items = await requestDA.getRequestItems(tx, id);
            let itemsTotal = 0;
            let available = 0;
            for (const item of items) {
                const l = lines.find((x) => Number(x.LineNumber) === item.LineNumber) || {};
                const isAvailable = l.IsAvailable !== false;
                const price = isAvailable ? money(l.QuotedUnitPrice) : null;
                const gst = Number(l.GstPercent) || 0;
                if (!GST_RATES.includes(gst)) throw fail(400, 'Choose a valid GST rate on every line.');
                if (l.HsnCode && !/^\d{4,8}$/.test(l.HsnCode)) throw fail(400, 'HSN codes are 4 to 8 digits.');
                if (isAvailable) {
                    if (!(price > 0)) throw fail(400, 'Enter a price for every available line.');
                    itemsTotal += price * item.Qty;
                    available += 1;
                }
                await requestDA.updateRequestItemQuote(tx, id, { lineNumber: item.LineNumber, isAvailable, price, gstPercent: gst, hsnCode: text(l.HsnCode, 8) });
            }
            if (!available) throw fail(400, 'Nothing is marked available. Use "Can\'t supply" instead.');
            itemsTotal = money(itemsTotal);
            total = money(itemsTotal + ship);
            await requestDA.updateRequestQuote(tx, id, { itemsTotal, shipping: ship, total, validUntil, note: text(note, 1000) });
            await requestDA.insertRequestHistory(tx, { requestId: id, status: 'QUOTED', note: `Quote sent: ₹${total.toLocaleString('en-IN')}`, adminId });
        });
        await audit({ actorId: adminId, action: 'REQUEST_QUOTED', entityType: 'Request', entityId: id, details: { total } });
        const result = await exports.getRequestById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in requestService.sendQuote', err);
        throw err;
    }
};

// "Can't supply": rejects the request with a reason the customer will see.
exports.rejectRequest = async (adminId, requestId, reason) => {
    try {
        const id = needGuid(requestId, 'request');
        const why = text(reason, 500);
        if (!why) throw fail(400, 'Tell the customer why (they will see this).');
        await requestDA.withTransaction(async (tx) => {
            const r = await lockedRequest(tx, id);
            if (!CAN_QUOTE_OR_REJECT.includes(r.Status)) throw fail(409, "This request can't be rejected now.");
            await requestDA.markRequestRejected(tx, id, why);
            await requestDA.insertRequestHistory(tx, { requestId: id, status: 'REJECTED', note: why, adminId });
        });
        await audit({ actorId: adminId, action: 'REQUEST_REJECTED', entityType: 'Request', entityId: id });
        const result = await exports.getRequestById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in requestService.rejectRequest', err);
        throw err;
    }
};

// Records a payment on a quoted request. Once the full amount is in, it is marked paid and the GST invoice is issued.
exports.recordRequestPayment = async (adminId, requestId, paymentData) => {
    try {
        const id = needGuid(requestId, 'request');
        await requestDA.withTransaction(async (tx) => {
            const r = await lockedRequest(tx, id);
            if (r.Status !== 'QUOTED') throw fail(409, 'Payments can be recorded only on a quoted request.');
            const paidSoFar = await requestDA.getRequestPaidSoFar(tx, id);
            const p = cleanPayment(paymentData, money(r.QuoteTotal - paidSoFar));
            await requestDA.insertRequestPayment(tx, id, { ...p, adminId });
            const paid = money(paidSoFar + p.amount);
            const full = paid + 0.005 >= r.QuoteTotal;
            await requestDA.insertRequestHistory(tx, {
                requestId: id,
                status: 'PAYMENT',
                note: `Payment received: ${p.method}${p.reference ? ` · ${p.reference}` : ''} · ₹${p.amount}${full ? '' : ` (part, ₹${money(r.QuoteTotal - paid)} still due)`}`,
                adminId,
            });
            if (full) {
                await requestDA.markRequestPaid(tx, id);
                await requestDA.insertRequestHistory(tx, { requestId: id, status: 'PAID', adminId });
                await issueInvoice(tx, { kind: 'request', id });
            }
        });
        await audit({ actorId: adminId, action: 'REQUEST_PAYMENT', entityType: 'Request', entityId: id });
        const result = await exports.getRequestById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in requestService.recordRequestPayment', err);
        throw err;
    }
};

// Moves a paid request to its next step. Dispatch needs courier + tracking.
exports.advanceRequest = async (adminId, requestId, stepData = {}) => {
    try {
        const id = needGuid(requestId, 'request');
        await requestDA.withTransaction(async (tx) => {
            const r = await lockedRequest(tx, id);
            const next = NEXT[r.FulfilmentType][r.Status];
            if (!next) throw fail(409, 'No next step.');
            let note = null;
            if (next === 'DISPATCHED') {
                const courierName = text(stepData.courierName, 80);
                const trackingNo = text(stepData.trackingNo, 60);
                if (!courierName || !trackingNo) throw fail(400, 'Enter the courier name and tracking number.');
                await requestDA.updateRequestShipping(tx, id, { courierName, trackingNo, trackingUrl: text(stepData.trackingUrl, 400) });
                note = `${courierName} · ${trackingNo}`;
            }
            await requestDA.updateRequestStatus(tx, id, next);
            await requestDA.insertRequestHistory(tx, { requestId: id, status: next, note, adminId });
        });
        const result = await exports.getRequestById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in requestService.advanceRequest', err);
        throw err;
    }
};

// An attached book list (for the signed-in owner only). Returns the file and how to send it.
exports.getRequestAttachment = async (requestId, attachmentId) => {
    try {
        const a = await requestDA.getRequestAttachment(needGuid(requestId, 'request'), needGuid(attachmentId, 'file'));
        if (!a) throw fail(404, 'File not found.');
        const data = await fileStore.get(a.StorageKey);
        return { data, contentType: a.ContentType, fileName: a.FileName.replace(/[^\w.\- ]/g, '_') };
    } catch (err) {
        if (!err.status) console.log('error in requestService.getRequestAttachment', err);
        throw err;
    }
};
