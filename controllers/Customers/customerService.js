// Business rules for customers: search, customer page, temporary passwords, blocking.
// No SQL and no req/res here: the database goes through customerDA.js, the HTTP side is customerHandler.js.
// Each exported function: try → do the work → return the result; catch → log unexpected errors → throw to the handler.
const crypto = require('crypto');
const argon2 = require('argon2');

const { fail, needGuid, text } = require('../../utils/access');
const { audit } = require('../../utils/shop');
const customerDA = require('./customerDA');

// Words for easy-to-read temporary passwords, e.g. "shelf-4821-ink".
const WORDS = ['book', 'page', 'ink', 'shelf', 'desk', 'chalk', 'slate', 'atlas', 'quill', 'paper'];

/* ---------------- helpers ---------------- */

const likePattern = (q) => {
    const t = text(q, 100);
    return t ? `%${t.replace(/[%_[]/g, '[$&]')}%` : null;
};

const temporaryPassword = () => `${WORDS[crypto.randomInt(WORDS.length)]}-${crypto.randomInt(1000, 10000)}-${WORDS[crypto.randomInt(WORDS.length)]}`;

/* ---------------- service functions (called by customerHandler.js) ---------------- */

// Up to 500 customers, most recently active first.
exports.getCustomers = async (search) => {
    try {
        const result = await customerDA.getCustomers(likePattern(search));
        return result;
    } catch (err) {
        if (!err.status) console.log('error in customerService.getCustomers', err);
        throw err;
    }
};

// One customer with their addresses, orders and requests.
exports.getCustomerById = async (customerId) => {
    try {
        const { customer, addresses, orders, requests } = await customerDA.getCustomerById(needGuid(customerId, 'customer'));
        if (!customer) throw fail(404, 'That customer was not found.');
        const result = { ...customer, Addresses: addresses, Orders: orders, Requests: requests };
        return result;
    } catch (err) {
        if (!err.status) console.log('error in customerService.getCustomerById', err);
        throw err;
    }
};

// A temporary password the owner sends on WhatsApp. The customer must change it at the next sign-in.
exports.resetCustomerPassword = async (adminId, customerId) => {
    try {
        const id = needGuid(customerId, 'customer');
        const c = await customerDA.getCustomerContact(id);
        if (!c) throw fail(404, 'That customer was not found.');
        const temp = temporaryPassword();
        await customerDA.updateCustomerPassword(id, await argon2.hash(temp));
        await audit({ actorId: adminId, action: 'CUSTOMER_PASSWORD_RESET', entityType: 'Customer', entityId: id });
        return { temporaryPassword: temp, mobile: c.Mobile, name: c.Name };
    } catch (err) {
        if (!err.status) console.log('error in customerService.resetCustomerPassword', err);
        throw err;
    }
};

// Blocks (active = false) or unblocks a customer. A blocked customer is signed out at once.
exports.setCustomerActive = async (adminId, customerId, active) => {
    try {
        const id = needGuid(customerId, 'customer');
        await customerDA.updateCustomerActive(id, Boolean(active));
        await audit({ actorId: adminId, action: active ? 'CUSTOMER_UNBLOCKED' : 'CUSTOMER_BLOCKED', entityType: 'Customer', entityId: id });
        const result = await exports.getCustomerById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in customerService.setCustomerActive', err);
        throw err;
    }
};
