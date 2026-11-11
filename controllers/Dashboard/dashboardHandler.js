// HTTP side of the dashboard and reports.
// Each handler: read what the admin panel sent → call ONE service function → send the result.
// Errors: a service error with `status` (from fail()) is a message for the owner; anything else is logged and becomes a 500.
const dashboardService = require('./dashboardService');

exports.getDashboard = async (req, res) => {
    try {
        const result = await dashboardService.getDashboard();
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the dashboard', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load the dashboard.' });
    }
};

exports.getReport = async (req, res) => {
    try {
        const { from, to } = req.query;
        const result = await dashboardService.getReport(from, to);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the report', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load the report.' });
    }
};
