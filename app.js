require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { warmUp } = require('./db');
const { authenticate } = require('./utils/auth');

const app = express();

// Standard security headers. Product photos are shown by the web apps from another address,
// so files may be read cross-origin; nothing here is a web page, so no page policy is needed.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.set('trust proxy', 1);

// Product photos and request attachments arrive as base64 inside JSON (up to 6 × 3 MB per product).
app.use(express.json({ limit: '25mb' }));

// CORS_ORIGINS: comma-separated web addresses allowed to call the API. Not set: any origin (local development).
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));

app.get('/health', (req, res) => res.json({ ok: true }));

// Every /admin route needs a signed-in owner, except POST /admin/login and public product photos.
app.use('/admin', authenticate);
app.use('/admin', require('./controllers/Auth'));
app.use('/admin', require('./controllers/Settings'));
app.use('/admin', require('./controllers/Catalogue'));
app.use('/admin', require('./controllers/Orders'));
app.use('/admin', require('./controllers/Requests'));
app.use('/admin', require('./controllers/Customers'));
app.use('/admin', require('./controllers/Invoices'));
app.use('/admin', require('./controllers/Dashboard'));
app.use('/admin', require('./controllers/Files'));

app.use((req, res) => res.status(404).json({ message: 'Not found.' }));
// Bad JSON or a body over the limit.
app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ message: 'That upload is too large.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'The request was not valid JSON.' });
    console.error(error);
    return res.status(500).json({ message: 'Something went wrong.' });
});

const PORT = Number(process.env.PORT) || 5101;

if (require.main === module) {
    warmUp();
    app.listen(PORT, () => console.log(`Kiran Book Center admin API running on port ${PORT}`));
}

module.exports = app;
