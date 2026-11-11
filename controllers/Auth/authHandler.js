// HTTP side of the owner's sign-in.
// Each handler: read what the admin panel sent → call ONE service function → send the result.
// Errors: a service error with `status` (from fail()) is a message for the owner; anything else is logged and becomes a 500.
const authService = require('./authService');

exports.loginAdmin = async (req, res) => {
    try {
        const { userName, password } = req.body || {};
        const result = await authService.loginAdmin(userName, password);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while signing in', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to sign in.' });
    }
};

exports.getMe = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const result = await authService.getMe(adminId);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while loading the signed-in owner', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load your account.' });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const adminId = req.admin.adminId;
        const { current, next } = req.body || {};
        const result = await authService.changePassword(adminId, current, next);
        return res.status(200).json(result);
    } catch (err) {
        if (!err.status) console.log('error while changing the password', err);
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to change the password.' });
    }
};
