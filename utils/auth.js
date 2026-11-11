const crypto = require('crypto');

const { customQuery } = require('./dbFunctions');

// Owner sessions: signed tokens (HMAC-SHA256, JWT layout) with their own secret (ADMIN_AUTH_SECRET),
// so a customer token from the shop API is never accepted here.

const TOKEN_TTL_SECONDS = Number(process.env.ADMIN_TOKEN_TTL_SECONDS) || 12 * 60 * 60;

// Routes reachable without signing in (path after /admin). Product photos are public so <img> tags work.
const isPublic = (req) => (req.method === 'POST' && req.path === '/login') || (req.method === 'GET' && req.path.startsWith('/files/products/'));

const getSecret = () => {
    const secret = process.env.ADMIN_AUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error('ADMIN_AUTH_SECRET is missing or shorter than 32 characters.');
    return secret;
};

const base64url = (input) => Buffer.from(input).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');

const issueToken = (adminId) => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ sub: String(adminId), typ: 'admin', iat: now, exp: now + TOKEN_TTL_SECONDS }));
    return { token: `${header}.${payload}.${sign(`${header}.${payload}`)}`, expiresAt: new Date((now + TOKEN_TTL_SECONDS) * 1000).toISOString() };
};

const verifyToken = (token) => {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expected = Buffer.from(sign(`${header}.${payload}`));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (claims.typ !== 'admin' || !claims.sub || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;
        return claims;
    } catch {
        return null;
    }
};

// ---------- wrong-password limit: 5 failures per username, then 15 minutes locked ----------
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map();
const loginKey = (userName) => String(userName || '').trim().toLowerCase();

const checkLock = (userName) => {
    const entry = failures.get(loginKey(userName));
    if (entry?.until && entry.until > Date.now()) {
        const minutes = Math.ceil((entry.until - Date.now()) / 60000);
        return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
    return null;
};
const recordFailure = (userName) => {
    const key = loginKey(userName);
    const entry = failures.get(key) || { count: 0, until: 0 };
    if (entry.until && entry.until <= Date.now()) Object.assign(entry, { count: 0, until: 0 });
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) entry.until = Date.now() + LOCK_MS;
    failures.set(key, entry);
};
const clearFailures = (userName) => failures.delete(loginKey(userName));

// ---------- every protected request ----------
const authenticate = async (req, res, next) => {
    if (req.method === 'OPTIONS' || isPublic(req)) return next();
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    const claims = match ? verifyToken(match[1].trim()) : null;
    if (!claims) return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    try {
        // A deactivated admin is signed out at once.
        const [admin] = await customQuery('SELECT AdminId, Name FROM dbo.Admins WHERE AdminId = @Id AND IsActive = 1', { Id: claims.sub });
        if (!admin) return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
        req.admin = { adminId: admin.AdminId, name: admin.Name };
        return next();
    } catch (error) {
        console.error('Error checking the session:', error);
        return res.status(500).json({ message: 'Failed to check your session.' });
    }
};

module.exports = { issueToken, verifyToken, authenticate, checkLock, recordFailure, clearFailures };
