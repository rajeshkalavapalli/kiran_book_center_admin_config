const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Error carrying an HTTP status; handlers send `message` as-is when `status` is set.
const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});

const isGuid = (value) => GUID.test(String(value ?? ''));
const needGuid = (value, what = 'record') => {
    if (!isGuid(value)) throw fail(404, `That ${what} was not found.`);
    return String(value).toLowerCase();
};

const text = (value, max) => {
    const t = String(value ?? '').trim();
    return t ? t.slice(0, max) : null;
};
const money = (n) => Math.round(Number(n || 0) * 100) / 100;

module.exports = { fail, isGuid, needGuid, text, money };
