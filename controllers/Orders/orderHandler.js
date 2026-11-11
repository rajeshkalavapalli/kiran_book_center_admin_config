// HTTP side of managing orders.
// Each handler: read what the admin panel sent → call ONE service function → send the result.
// Errors: a service error with `status` (from fail()) is a message for the owner; anything else is logged and becomes a 500.
const orderService = require('./orderService');

exports.getOrders = async (req, res) => {
    try {
        const filters = req.query;
        const result = await orderService.getOrders(filters);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the orders', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load orders.' });
    }
};

exports.getOrderById = async (req, res) => {
    try {
        const { orderId } = req.params;
        const result = await orderService.getOrderById(orderId);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the order', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load the order.' });
    }
};

exports.advanceOrder = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { orderId } = req.params;
        const stepData = req.body || {};
        const result = await orderService.advanceOrder(adminId, orderId, stepData);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while updating the order', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to update the order.' });
    }
};

exports.cancelOrder = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { orderId } = req.params;
        const { reason } = req.body || {};
        const result = await orderService.cancelOrder(adminId, orderId, reason);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while cancelling the order', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to cancel the order.' });
    }
};

exports.recordOrderPayment = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { orderId } = req.params;
        const paymentData = req.body || {};
        const result = await orderService.recordOrderPayment(adminId, orderId, paymentData);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while recording the order payment', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to record the payment.' });
    }
};

exports.issueOrderInvoice = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { orderId } = req.params;
        const result = await orderService.issueOrderInvoice(adminId, orderId);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while issuing the invoice', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to issue the invoice.' });
    }
};
