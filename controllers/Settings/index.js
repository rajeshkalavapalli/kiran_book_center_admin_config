// Routes for shop settings and delivery charges. Routes only: the work is in settingsHandler.js.
const express = require('express');

const settingsHandler = require('./settingsHandler');

const router = express.Router();

router.get('/settings', settingsHandler.getSettings);
router.put('/settings', settingsHandler.saveSettings);
router.put('/shipping', settingsHandler.saveShipping);

module.exports = router;
