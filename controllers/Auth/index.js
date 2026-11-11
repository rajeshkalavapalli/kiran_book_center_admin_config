// Routes for the owner's sign-in. Routes only: the work is in authHandler.js.
// POST /login is public (see utils/auth.js); everything else needs a signed-in owner.
const express = require('express');

const authHandler = require('./authHandler');

const router = express.Router();

router.post('/login', authHandler.loginAdmin);
router.get('/me', authHandler.getMe);
router.put('/password', authHandler.changePassword);

module.exports = router;
