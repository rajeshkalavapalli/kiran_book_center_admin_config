require('dotenv').config({ quiet: true });

const sql = require('mssql');

const dbConfig = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 1433,
    connectionTimeout: 30000,
    requestTimeout: 60000,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: {
        // Azure SQL needs an encrypted connection (DB_ENCRYPT=true); a local SQL Server doesn't.
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_ENCRYPT !== 'true',
    },
};

const RETRY_MS = 5000;

// One shared pool. If connecting fails, the next request starts a fresh attempt
// instead of every request failing until the server is restarted.
let current = null;

const connect = () => {
    if (!current) {
        const pool = new sql.ConnectionPool(dbConfig);
        pool.on('error', (error) => console.error('Database pool error:', error.message));
        current = pool.connect().catch((error) => {
            current = null;
            throw error;
        });
    }
    return current;
};

const warmUp = () =>
    connect()
        .then(() => console.log('Connected to the database.'))
        .catch((error) => {
            console.error(`Database not reachable yet (${error.message}). Trying again in ${RETRY_MS / 1000} s.`);
            setTimeout(warmUp, RETRY_MS);
        });

module.exports = {
    sql,
    warmUp,
    get poolPromise() {
        return connect();
    },
};
