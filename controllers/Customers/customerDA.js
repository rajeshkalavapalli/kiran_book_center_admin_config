// Data access for customers: runs the queries in sql.js and returns plain rows.
const { customQuery, multiQuery } = require('../../utils/dbFunctions');
const sql = require('./sql');

exports.getCustomers = async (search) => {
    return await customQuery(sql.GET_CUSTOMERS(), { Q: search });
};

exports.getCustomerById = async (customerId) => {
    const [[customer], addresses, orders, requests] = await multiQuery(sql.GET_CUSTOMER_BY_ID(), { Id: customerId });
    return { customer, addresses, orders, requests };
};

exports.getCustomerContact = async (customerId) => {
    const [row] = await customQuery(sql.GET_CUSTOMER_CONTACT(), { Id: customerId });
    return row || null;
};

exports.updateCustomerPassword = async (customerId, passwordHash) => {
    return await customQuery(sql.UPDATE_CUSTOMER_PASSWORD(), { Id: customerId, Hash: passwordHash });
};

exports.updateCustomerActive = async (customerId, active) => {
    return await customQuery(sql.UPDATE_CUSTOMER_ACTIVE(), { Id: customerId, Active: active });
};
