// Routes for the dashboard and reports. Routes only: the work is in dashboardHandler.js.
const express = require('express');

const dashboardHandler = require('./dashboardHandler');

const router = express.Router();

router.get('/dashboard', dashboardHandler.getDashboard);
router.get('/reports', dashboardHandler.getReport);

module.exports = router;
