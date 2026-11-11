// Data access for the owner's account: runs the queries in sql.js and returns plain rows.
const { customQuery } = require('../../utils/dbFunctions');
const sql = require('./sql');

exports.getAdminByUsername = async (userName) => {
    const [row] = await customQuery(sql.GET_ADMIN_BY_USERNAME(), { UserName: userName });
    return row || null;
};

exports.getAdminById = async (adminId) => {
    const [row] = await customQuery(sql.GET_ADMIN_BY_ID(), { Id: adminId });
    return row || null;
};

exports.getAdminPasswordHash = async (adminId) => {
    const [row] = await customQuery(sql.GET_ADMIN_PASSWORD_HASH(), { Id: adminId });
    return row?.PasswordHash || null;
};

exports.updateAdminPassword = async (adminId, passwordHash) => {
    return await customQuery(sql.UPDATE_ADMIN_PASSWORD(), { Id: adminId, Hash: passwordHash });
};

exports.updateLastLogin = async (adminId) => {
    return await customQuery(sql.UPDATE_LAST_LOGIN(), { Id: adminId });
};
