// Data access for shop settings and delivery zones: runs the queries in sql.js and returns plain rows.
// Functions that take `tx` run inside the caller's transaction.
const { customQuery, inTransaction } = require('../../utils/dbFunctions');
const sql = require('./sql');

const run = (tx) => (tx ? tx.run : customQuery);

exports.withTransaction = inTransaction;

exports.getShippingZones = async () => {
    return await customQuery(sql.GET_SHIPPING_ZONES());
};

exports.getLocalPincodes = async () => {
    return await customQuery(sql.GET_LOCAL_PINCODES());
};

exports.upsertSetting = async (tx, key, value) => {
    return await run(tx)(sql.UPSERT_SETTING(), { K: key, V: value });
};

exports.updateShippingZone = async (tx, z) => {
    return await run(tx)(sql.UPDATE_SHIPPING_ZONE(), { Code: z.code, Charge: z.charge, FreeAbove: z.freeAbove, EtaDays: z.etaDays, IsActive: z.isActive });
};

exports.getLocalZone = async (tx) => {
    const [row] = await run(tx)(sql.GET_LOCAL_ZONE());
    return row || null;
};

exports.deleteZonePincodes = async (tx, zoneId) => {
    return await run(tx)(sql.DELETE_ZONE_PINCODES(), { ZoneId: zoneId });
};

exports.insertZonePincode = async (tx, zoneId, pincode) => {
    return await run(tx)(sql.INSERT_ZONE_PINCODE(), { ZoneId: zoneId, Pincode: pincode });
};
