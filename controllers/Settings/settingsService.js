// Business rules for shop settings and delivery charges: which keys may change, GSTIN/IFSC/UPI checks.
// No SQL and no req/res here: the database goes through settingsDA.js, the HTTP side is settingsHandler.js.
// Each exported function: try → do the work → return the result; catch → log unexpected errors → throw to the handler.
const { fail, money } = require('../../utils/access');
const { loadSettings, audit } = require('../../utils/shop');
const settingsDA = require('./settingsDA');

// Keys the owner may change from the admin panel (anything else in the body is ignored).
const EDITABLE = [
    'shop.name', 'shop.tagline', 'shop.addressLine1', 'shop.addressLine2', 'shop.city', 'shop.state', 'shop.stateCode', 'shop.pincode',
    'shop.phone', 'shop.phone2', 'shop.phone3', 'shop.whatsapp', 'shop.email', 'shop.hours', 'shop.mapUrl', 'shop.mapEmbed',
    'gst.gstin', 'gst.invoicePrefix',
    'payment.upiId', 'payment.upiName', 'payment.bankName', 'payment.bankAccount', 'payment.bankIfsc', 'payment.bankHolder',
    'payment.codEnabled', 'payment.upiLaterEnabled', 'order.pickupEnabled', 'order.maxQtyPerItem',
];

/* ---------------- helpers ---------------- */

// Picks the editable keys from the body, checks them, and returns clean values.
const cleanSettings = (body) => {
    const values = {};
    EDITABLE.forEach((k) => {
        if (k in body) values[k] = body[k] == null ? null : String(body[k]).trim();
    });
    const gstin = (values['gst.gstin'] || '').toUpperCase();
    if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw fail(400, "The GSTIN doesn't look right (15 characters, e.g. 36ABCDE1234F1Z5).");
    if (gstin && values['shop.stateCode'] && gstin.slice(0, 2) !== values['shop.stateCode']) throw fail(400, "The first two digits of the GSTIN should match the shop's state code.");
    if (values['shop.pincode'] && !/^\d{6}$/.test(values['shop.pincode'])) throw fail(400, 'Shop pincode must be 6 digits.');
    if (values['payment.bankIfsc'] && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(values['payment.bankIfsc'].toUpperCase())) throw fail(400, 'IFSC looks wrong (11 characters, e.g. SBIN0001234).');
    if (values['payment.upiId'] && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(values['payment.upiId'])) throw fail(400, 'UPI ID looks wrong (e.g. kiranbooks@okbank).');
    if ('gst.gstin' in values) values['gst.gstin'] = gstin || null;
    if ('payment.bankIfsc' in values) values['payment.bankIfsc'] = values['payment.bankIfsc'] ? values['payment.bankIfsc'].toUpperCase() : null;
    return values;
};

// Settings, delivery zones and the local pincodes, as the Settings page shows them.
const loadAll = async () => {
    const [settings, zones, pincodes] = await Promise.all([loadSettings(), settingsDA.getShippingZones(), settingsDA.getLocalPincodes()]);
    return { settings, zones, pincodes: pincodes.map((p) => p.Pincode) };
};

/* ---------------- service functions (called by settingsHandler.js) ---------------- */

exports.getSettings = async () => {
    try {
        const result = await loadAll();
        return result;
    } catch (err) {
        if (!err.status) console.log('error in settingsService.getSettings', err);
        throw err;
    }
};

// Saves shop details, GST, bank/UPI and order switches. Returns the saved settings.
exports.saveSettings = async (adminId, settingsData) => {
    try {
        const values = cleanSettings(settingsData);
        await settingsDA.withTransaction(async (tx) => {
            for (const [k, v] of Object.entries(values)) await settingsDA.upsertSetting(tx, k, v);
        });
        await audit({ actorId: adminId, action: 'SETTINGS_UPDATED', details: Object.keys(values) });
        const result = (await loadAll()).settings;
        return result;
    } catch (err) {
        if (!err.status) console.log('error in settingsService.saveSettings', err);
        throw err;
    }
};

// Saves the delivery zones (charge, free-above, delivery time) and the list of local pincodes.
exports.saveShipping = async (adminId, zones = [], pincodes = []) => {
    try {
        zones.forEach((z) => {
            if (!(Number(z.Charge) >= 0)) throw fail(400, `${z.Name}: charge must be 0 or more.`);
            if (z.FreeAbove !== '' && z.FreeAbove != null && !(Number(z.FreeAbove) > 0)) throw fail(400, `${z.Name}: "free above" must be more than 0, or empty.`);
        });
        const pins = [...new Set(pincodes.map((p) => String(p).trim()))];
        const bad = pins.find((p) => !/^[1-9]\d{5}$/.test(p));
        if (bad) throw fail(400, `"${bad}" is not a valid pincode.`);

        await settingsDA.withTransaction(async (tx) => {
            for (const z of zones) {
                await settingsDA.updateShippingZone(tx, {
                    code: z.Code,
                    charge: money(z.Charge),
                    freeAbove: z.FreeAbove === '' || z.FreeAbove == null ? null : money(z.FreeAbove),
                    etaDays: z.EtaDays ? String(z.EtaDays).slice(0, 20) : null,
                    isActive: z.IsActive !== false,
                });
            }
            const local = await settingsDA.getLocalZone(tx);
            await settingsDA.deleteZonePincodes(tx, local.ZoneId);
            for (const p of pins) await settingsDA.insertZonePincode(tx, local.ZoneId, p);
        });
        await audit({ actorId: adminId, action: 'SHIPPING_UPDATED', details: { pincodes: pins.length } });
        const all = await loadAll();
        return { zones: all.zones, pincodes: all.pincodes };
    } catch (err) {
        if (!err.status) console.log('error in settingsService.saveShipping', err);
        throw err;
    }
};
