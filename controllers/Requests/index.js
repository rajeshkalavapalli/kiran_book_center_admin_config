// Routes for managing book requests and bulk enquiries. Routes only: the work is in requestHandler.js.
const express = require('express');

const requestHandler = require('./requestHandler');

const router = express.Router();

router.get('/requests', requestHandler.getRequests);
router.get('/requests/:requestId', requestHandler.getRequestById);
router.post('/requests/:requestId/review', requestHandler.startReview);
router.put('/requests/:requestId/quote', requestHandler.sendQuote);
router.post('/requests/:requestId/reject', requestHandler.rejectRequest);
router.post('/requests/:requestId/payments', requestHandler.recordRequestPayment);
router.post('/requests/:requestId/advance', requestHandler.advanceRequest);
router.get('/requests/:requestId/attachments/:attachmentId', requestHandler.getRequestAttachment);

module.exports = router;
