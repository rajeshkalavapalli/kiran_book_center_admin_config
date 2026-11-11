// Raw-query helpers (same shape as Pharmalyx).
//   customQuery(sql, inputs)   one statement batch, returns the first recordset
//   inTransaction(work)        work(tx) inside one transaction; tx.run(sql, inputs) returns the recordset.
//                              Anything thrown rolls everything back.
const db = require('../db');

const addInputs = (request, inputs) => Object.entries(inputs).forEach(([name, value]) => request.input(name, value === undefined ? null : value));

const customQuery = async (sqlQuery, inputs = {}) => {
    const pool = await db.poolPromise;
    const request = pool.request();
    addInputs(request, inputs);
    const result = await request.query(sqlQuery);
    return result.recordset ?? [];
};

// All recordsets of a multi-SELECT batch.
const multiQuery = async (sqlQuery, inputs = {}) => {
    const pool = await db.poolPromise;
    const request = pool.request();
    addInputs(request, inputs);
    const result = await request.query(sqlQuery);
    return result.recordsets || [];
};

const inTransaction = async (work) => {
    const pool = await db.poolPromise;
    const transaction = pool.transaction();
    await transaction.begin();
    try {
        const tx = {
            run: async (sqlText, inputs = {}) => {
                const request = new db.sql.Request(transaction);
                addInputs(request, inputs);
                const result = await request.query(sqlText);
                return result.recordset || [];
            },
        };
        const result = await work(tx);
        await transaction.commit();
        return result;
    } catch (error) {
        await transaction.rollback().catch(() => null);
        throw error;
    }
};

module.exports = { customQuery, multiQuery, inTransaction };
