// HTTP side of shop settings and delivery charges.
// Each handler: read what the admin panel sent → call ONE service function → send the result.
// Errors: a service error with `status` (from fail()) is a message for the owner; anything else is logged and becomes a 500.
const settingsService = require('./settingsService');

exports.getSettings = async (req, res) => {
    try {
        const result = await settingsService.getSettings();
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the settings', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load settings.' });
    }
};

exports.saveSettings = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const settingsData = req.body || {};
        const result = await settingsService.saveSettings(adminId, settingsData);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while saving the settings', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to save settings.' });
    }
};

exports.saveShipping = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { zones, pincodes } = req.body || {};
        const result = await settingsService.saveShipping(adminId, zones, pincodes);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while saving the delivery charges', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to save delivery charges.' });
    }
};
