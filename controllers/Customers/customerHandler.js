// HTTP side of customers.
// Each handler: read what the admin panel sent → call ONE service function → send the result.
// Errors: a service error with `status` (from fail()) is a message for the owner; anything else is logged and becomes a 500.
const customerService = require('./customerService');

exports.getCustomers = async (req, res) => {
    try {
        const { q } = req.query;
        const result = await customerService.getCustomers(q);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the customers', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load customers.' });
    }
};

exports.getCustomerById = async (req, res) => {
    try {
        const { customerId } = req.params;
        const result = await customerService.getCustomerById(customerId);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the customer', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load the customer.' });
    }
};

exports.resetCustomerPassword = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { customerId } = req.params;
        const result = await customerService.resetCustomerPassword(adminId, customerId);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while resetting the customer password', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to reset the password.' });
    }
};

exports.setCustomerActive = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { customerId } = req.params;
        const active = req.body?.active;
        const result = await customerService.setCustomerActive(adminId, customerId, active);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while updating the customer', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to update the customer.' });
    }
};
