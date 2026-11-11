// HTTP side of managing requests.
// Each handler: read what the admin panel sent → call ONE service function → send the result.
// Errors: a service error with `status` (from fail()) is a message for the owner; anything else is logged and becomes a 500.
const requestService = require('./requestService');

exports.getRequests = async (req, res) => {
    try {
        const filters = req.query;
        const result = await requestService.getRequests(filters);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the requests', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load requests.' });
    }
};

exports.getRequestById = async (req, res) => {
    try {
        const { requestId } = req.params;
        const result = await requestService.getRequestById(requestId);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the request', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load the request.' });
    }
};

exports.startReview = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { requestId } = req.params;
        const result = await requestService.startReview(adminId, requestId);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while starting the review', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to start the review.' });
    }
};

exports.sendQuote = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { requestId } = req.params;
        const quoteData = req.body || {};
        const result = await requestService.sendQuote(adminId, requestId, quoteData);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while sending the quote', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to send the quote.' });
    }
};

exports.rejectRequest = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { requestId } = req.params;
        const { reason } = req.body || {};
        const result = await requestService.rejectRequest(adminId, requestId, reason);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while rejecting the request', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to update the request.' });
    }
};

exports.recordRequestPayment = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { requestId } = req.params;
        const paymentData = req.body || {};
        const result = await requestService.recordRequestPayment(adminId, requestId, paymentData);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while recording the request payment', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to record the payment.' });
    }
};

exports.advanceRequest = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { requestId } = req.params;
        const stepData = req.body || {};
        const result = await requestService.advanceRequest(adminId, requestId, stepData);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while updating the request', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to update the request.' });
    }
};

// Sends the file itself (not JSON), shown inline in the browser.
exports.getRequestAttachment = async (req, res) => {
    try {
        const { requestId, attachmentId } = req.params;
        const result = await requestService.getRequestAttachment(requestId, attachmentId);
        res.set('Content-Type', result.contentType);
        res.set('Content-Disposition', `inline; filename="${result.fileName}"`);
        return res.status(200).send(result.data);
    } catch (err) {
        if (!err.status) console.log('error while opening the attachment', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to open the file.' });
    }
};
