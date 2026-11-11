// Business rules for the owner's sign-in: password check, lockout after wrong tries, tokens.
// No SQL and no req/res here: the database goes through authDA.js, the HTTP side is authHandler.js.
// Each exported function: try → do the work → return the result; catch → log unexpected errors → throw to the handler.
const argon2 = require('argon2');

const { fail } = require('../../utils/access');
const { issueToken, checkLock, recordFailure, clearFailures } = require('../../utils/auth');
const { audit } = require('../../utils/shop');
const authDA = require('./authDA');

// The same message for an unknown username and a wrong password, so usernames can't be probed.
const WRONG = 'Incorrect username or password.';

const passwordMatches = (hash, password) => (hash ? argon2.verify(hash, String(password || '')).catch(() => false) : false);

// Sign-in with username + password. Locks for 15 minutes after 5 wrong tries.
exports.loginAdmin = async (userName, password) => {
    try {
        const name = String(userName || '').trim().toLowerCase();
        if (!name || !password) throw fail(400, 'Enter your username and password.');
        const locked = checkLock(name);
        if (locked) throw fail(429, locked);
        const admin = await authDA.getAdminByUsername(name);
        if (!(await passwordMatches(admin?.PasswordHash, password))) {
            recordFailure(name);
            await audit({ actorId: admin?.AdminId || null, action: 'SIGN_IN_FAILED', details: { userName: name } });
            throw fail(401, WRONG);
        }
        clearFailures(name);
        await authDA.updateLastLogin(admin.AdminId);
        await audit({ actorId: admin.AdminId, action: 'SIGN_IN' });
        const result = { admin: { adminId: admin.AdminId, userName: admin.UserName, name: admin.Name }, ...issueToken(admin.AdminId) };
        return result;
    } catch (err) {
        if (!err.status) console.log('error in authService.loginAdmin', err);
        throw err;
    }
};

// The signed-in owner (fails if the account was switched off meanwhile).
exports.getMe = async (adminId) => {
    try {
        const admin = await authDA.getAdminById(adminId);
        if (!admin) throw fail(401, 'Your session has expired. Please sign in again.');
        const result = { admin: { adminId: admin.AdminId, userName: admin.UserName, name: admin.Name, lastLoginOn: admin.LastLoginOn } };
        return result;
    } catch (err) {
        if (!err.status) console.log('error in authService.getMe', err);
        throw err;
    }
};

exports.changePassword = async (adminId, current, next) => {
    try {
        if (!(await passwordMatches(await authDA.getAdminPasswordHash(adminId), current))) throw fail(400, 'Your current password is not correct.');
        if (String(next || '').length < 10 || !/[a-z]/i.test(next) || !/\d/.test(next)) throw fail(400, 'Use at least 10 characters, with a letter and a digit.');
        await authDA.updateAdminPassword(adminId, await argon2.hash(String(next)));
        await audit({ actorId: adminId, action: 'PASSWORD_CHANGED' });
        return { ok: true };
    } catch (err) {
        if (!err.status) console.log('error in authService.changePassword', err);
        throw err;
    }
};
