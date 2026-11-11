// Business rules for managing orders: the next status step, shipping details, cash collected on handover,
// cancelling (stock goes back), payments and issuing the GST invoice.
// No SQL and no req/res here: the database goes through orderDA.js, the HTTP side is orderHandler.js.
// Each exported function: try → do the work → return the result; catch → log unexpected errors → throw to the handler.
// cleanPayment is also used by Requests.
const { fail, needGuid, text, money } = require('../../utils/access');
const { audit, moveStock, issueInvoice } = require('../../utils/shop');
const orderDA = require('./orderDA');

// Next step per fulfilment type, and the statuses the shop may still cancel from.
const NEXT = {
    DELIVERY: { PLACED: 'CONFIRMED', CONFIRMED: 'PACKED', PACKED: 'SHIPPED', SHIPPED: 'DELIVERED' },
    PICKUP: { PLACED: 'CONFIRMED', CONFIRMED: 'READY_FOR_PICKUP', READY_FOR_PICKUP: 'PICKED_UP' },
};
const CAN_CANCEL = ['PLACED', 'CONFIRMED', 'PACKED', 'READY_FOR_PICKUP'];
const STATUSES = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED'];
const PAYMENT_STATUSES = ['PENDING', 'PAID', 'REFUNDED'];
const PAYMENT_METHODS = ['UPI', 'BANK', 'CASH', 'COD'];

/* ---------------- helpers ---------------- */

const likePattern = (q) => {
    const t = text(q, 100);
    return t ? `%${t.replace(/[%_[]/g, '[$&]')}%` : null;
};
const dateOrNull = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : null);

const lockedOrder = async (tx, id) => {
    const o = await orderDA.lockOrderById(tx, id);
    if (!o) throw fail(404, 'That order was not found.');
    return o;
};

// Checks one received payment (shared with Requests). An empty amount means "the full amount due".
exports.cleanPayment = (body, due) => {
    const amount = money(body.amount === '' || body.amount == null ? due : body.amount);
    if (!(amount > 0)) throw fail(400, 'Enter the amount received.');
    if (!PAYMENT_METHODS.includes(body.method)) throw fail(400, 'Choose how it was paid.');
    const reference = text(body.reference, 100);
    if ((body.method === 'UPI' || body.method === 'BANK') && !reference) throw fail(400, 'Enter the UTR / reference number so it can be matched later.');
    const receivedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.receivedOn || '')) ? new Date(`${body.receivedOn}T12:00:00`) : new Date();
    return { amount, method: body.method, reference, receivedOn, note: text(body.note, 300) };
};

/* ---------------- service functions (called by orderHandler.js) ---------------- */

// Order list with optional filters: q, status (or OPEN), payment, from, to.
exports.getOrders = async (query) => {
    try {
        const q = query || {};
        const result = await orderDA.getOrders({
            q: likePattern(q.q),
            status: q.status === 'OPEN' || STATUSES.includes(q.status) ? q.status : null,
            payment: PAYMENT_STATUSES.includes(q.payment) ? q.payment : null,
            from: dateOrNull(q.from),
            to: dateOrNull(q.to),
        });
        return result;
    } catch (err) {
        if (!err.status) console.log('error in orderService.getOrders', err);
        throw err;
    }
};

// One order with items, history, payments, invoice and customer.
exports.getOrderById = async (orderId) => {
    try {
        const { order, items, history, payments, invoice, customer } = await orderDA.getOrderById(needGuid(orderId, 'order'));
        if (!order) throw fail(404, 'That order was not found.');
        const result = {
            ...order,
            Items: items.map(({ ImageKey, ...i }) => ({ ...i, Images: ImageKey ? [ImageKey] : [] })),
            History: history,
            Payments: payments,
            Invoice: invoice || null,
            Customer: customer || null,
        };
        return result;
    } catch (err) {
        if (!err.status) console.log('error in orderService.getOrderById', err);
        throw err;
    }
};

// Moves the order to its next step. Shipping needs courier + tracking; handing over a COD order records the cash;
// the GST invoice is issued when the goods leave the shop (shipped or picked up).
exports.advanceOrder = async (adminId, orderId, stepData = {}) => {
    try {
        const id = needGuid(orderId, 'order');
        await orderDA.withTransaction(async (tx) => {
            const o = await lockedOrder(tx, id);
            const next = NEXT[o.FulfilmentType][o.Status];
            if (!next) throw fail(409, 'This order has no next step.');
            const notes = [];
            if (next === 'SHIPPED') {
                const courierName = text(stepData.courierName, 80);
                const trackingNo = text(stepData.trackingNo, 60);
                if (!courierName || !trackingNo) throw fail(400, 'Enter the courier name and tracking number to mark it shipped.');
                await orderDA.updateOrderShipping(tx, id, { courierName, trackingNo, trackingUrl: text(stepData.trackingUrl, 400) });
                notes.push(`${courierName} · ${trackingNo}`);
            }
            await orderDA.updateOrderStatus(tx, id, next);
            // Cash collected on delivery / at the counter: record it so the books balance.
            if ((next === 'DELIVERED' || next === 'PICKED_UP') && o.PaymentMethod === 'COD' && o.PaymentStatus === 'PENDING') {
                const due = money(o.GrandTotal - (await orderDA.getOrderPaidSoFar(tx, id)));
                if (due > 0) await orderDA.insertOrderPayment(tx, id, { method: 'COD', amount: due, reference: null, receivedOn: new Date(), adminId, note: 'Collected on handover' });
                await orderDA.markOrderPaid(tx, id);
                notes.push('Cash collected on handover.');
            }
            if (text(stepData.note, 300)) notes.push(text(stepData.note, 300));
            await orderDA.insertOrderHistory(tx, { orderId: id, status: next, note: notes.join(' · '), adminId });
            if (next === 'SHIPPED' || next === 'PICKED_UP') await issueInvoice(tx, { kind: 'order', id });
            await audit({ actorId: adminId, action: 'ORDER_STATUS', entityType: 'Order', entityId: id, details: { status: next } });
        });
        const result = await exports.getOrderById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in orderService.advanceOrder', err);
        throw err;
    }
};

// The shop cancels an order (before it ships). Stock goes back; any invoice is cancelled.
exports.cancelOrder = async (adminId, orderId, reason) => {
    try {
        const id = needGuid(orderId, 'order');
        const why = text(reason, 300);
        if (!why) throw fail(400, 'Enter a reason. The customer will see it.');
        await orderDA.withTransaction(async (tx) => {
            const o = await lockedOrder(tx, id);
            if (!CAN_CANCEL.includes(o.Status)) throw fail(409, "Shipped or completed orders can't be cancelled.");
            const items = await orderDA.getOrderItems(tx, id);
            for (const it of items) await moveStock(tx, { productId: it.ProductId, change: it.Qty, reason: 'CANCEL', refId: id, note: o.OrderNo, adminId });
            await orderDA.markOrderCancelled(tx, id, why);
            await orderDA.cancelOrderInvoices(tx, id);
            await orderDA.insertOrderHistory(tx, { orderId: id, status: 'CANCELLED', note: `Cancelled by the shop: ${why}`, adminId });
        });
        await audit({ actorId: adminId, action: 'ORDER_CANCELLED', entityType: 'Order', entityId: id, details: { reason: why } });
        const result = await exports.getOrderById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in orderService.cancelOrder', err);
        throw err;
    }
};

// Records a payment received (UPI, bank, cash). The order is marked paid once the full amount is in.
exports.recordOrderPayment = async (adminId, orderId, paymentData) => {
    try {
        const id = needGuid(orderId, 'order');
        await orderDA.withTransaction(async (tx) => {
            const o = await lockedOrder(tx, id);
            if (o.Status === 'CANCELLED') throw fail(409, 'This order is cancelled.');
            const paidSoFar = await orderDA.getOrderPaidSoFar(tx, id);
            const p = exports.cleanPayment(paymentData, money(o.GrandTotal - paidSoFar));
            await orderDA.insertOrderPayment(tx, id, { ...p, adminId });
            const total = money(paidSoFar + p.amount);
            if (total + 0.005 >= o.GrandTotal) await orderDA.markOrderPaid(tx, id);
            const rest = money(o.GrandTotal - total);
            await orderDA.insertOrderHistory(tx, {
                orderId: id,
                status: 'PAYMENT',
                note: `Payment received: ${p.method}${p.reference ? ` · ${p.reference}` : ''} · ₹${p.amount}${rest > 0 ? ` (part, ₹${rest} still due)` : ''}`,
                adminId,
            });
        });
        await audit({ actorId: adminId, action: 'ORDER_PAYMENT', entityType: 'Order', entityId: id, details: { method: paymentData.method, amount: paymentData.amount } });
        const result = await exports.getOrderById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in orderService.recordOrderPayment', err);
        throw err;
    }
};

// Issues the GST invoice now (normally automatic when the order ships or is picked up).
exports.issueOrderInvoice = async (adminId, orderId) => {
    try {
        const id = needGuid(orderId, 'order');
        await orderDA.withTransaction(async (tx) => {
            const o = await lockedOrder(tx, id);
            if (o.Status === 'CANCELLED') throw fail(409, "Cancelled orders don't get an invoice.");
            await issueInvoice(tx, { kind: 'order', id });
        });
        await audit({ actorId: adminId, action: 'INVOICE_ISSUED', entityType: 'Order', entityId: id });
        const result = await exports.getOrderById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in orderService.issueOrderInvoice', err);
        throw err;
    }
};
