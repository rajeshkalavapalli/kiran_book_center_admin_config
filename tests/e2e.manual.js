// End-to-end check of the admin API against the real database (uses .env).
//   node tests/e2e.manual.js
// Creates a temporary admin, customer, category, product, orders and a request (all named "ZZ TEST"),
// runs every owner flow through the HTTP API, then deletes everything it created and puts the
// invoice counter back. Safe to run on a development database; do not run on production.
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const argon2 = require('argon2');

const app = require('../app');
const db = require('../db');
const { customQuery } = require('../utils/dbFunctions');
const fileStore = require('../utils/fileStore');

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok: Boolean(ok) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

(async () => {
    await db.poolPromise;
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}/admin`;
    let token = null;
    const api = async (method, path, body) => {
        const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
        const type = res.headers.get('content-type') || '';
        return { status: res.status, body: type.includes('json') ? await res.json() : await res.arrayBuffer(), type };
    };

    const ids = { adminId: null, customerId: null, categoryId: null, productId: null, orders: [], requestId: null, imageKeys: [] };
    const seqBefore = await customQuery('SELECT FinancialYear, LastNo FROM dbo.InvoiceSequences');
    const adminName = `zz_test_${crypto.randomBytes(3).toString('hex')}`;
    const adminPass = `T3st-${crypto.randomBytes(9).toString('base64url')}`;

    try {
        /* ---------- auth ---------- */
        [{ AdminId: ids.adminId }] = await customQuery('INSERT INTO dbo.Admins (UserName, Name, PasswordHash) OUTPUT inserted.AdminId VALUES (@U, @N, @H)', { U: adminName, N: 'ZZ TEST Admin', H: await argon2.hash(adminPass) });
        let r = await api('POST', '/login', { userName: adminName, password: 'wrong-password-1' });
        check('Login with wrong password is refused', r.status === 401);
        r = await api('POST', '/login', { userName: adminName, password: adminPass });
        check('Login with the right password', r.status === 200 && r.body.token, `status ${r.status}`);
        token = r.body.token;
        r = await api('GET', '/me');
        check('GET /me returns the admin', r.status === 200 && r.body.admin.userName === adminName);

        /* ---------- settings ---------- */
        r = await api('GET', '/settings');
        check('Settings load (keys, 3 zones)', r.status === 200 && r.body.settings['shop.name'] && r.body.zones.length === 3);
        r = await api('PUT', '/settings', { 'gst.gstin': 'NOT-A-GSTIN' });
        check('Invalid GSTIN is refused', r.status === 400, r.body.message);

        /* ---------- catalogue ---------- */
        r = await api('POST', '/categories', { Name: `ZZ TEST Category ${adminName}` });
        check('Create category', r.status === 201 && r.body.CategoryId, `status ${r.status} ${r.body.message || ''}`);
        ids.categoryId = r.body.CategoryId;

        const product = { ProductType: 'BOOK', CategoryId: ids.categoryId, Title: `ZZ TEST Book ${adminName}`, Author: 'Test Author', Mrp: 200, PricingMode: 'NET', DiscountPercent: 10, NetPrice: '', GstPercent: 0, HsnCode: '4901', LowStockAt: 5, StockQty: 10, Images: [PNG] };
        r = await api('POST', '/products', product);
        check('Net price without a net price is refused', r.status === 400 && r.body.errors?.NetPrice, r.body.errors ? JSON.stringify(r.body.errors) : '');
        r = await api('POST', '/products', { ...product, PricingMode: 'DISCOUNT', DiscountPercent: 10 });
        check('Create product with photo and opening stock', r.status === 201 && Number(r.body.SellingPrice) === 180 && r.body.StockQty === 10 && r.body.Images.length === 1, `price ${r.body.SellingPrice}, stock ${r.body.StockQty}`);
        ids.productId = r.body.ProductId;
        ids.imageKeys = r.body.Images || [];

        const photo = await fetch(`${base}/files/${ids.imageKeys[0]}`);
        check('Product photo is served publicly as PNG', photo.status === 200 && photo.headers.get('content-type') === 'image/png');

        r = await api('PUT', `/products/${ids.productId}`, { ...product, PricingMode: 'NET', NetPrice: 200, DiscountPercent: '', Images: ids.imageKeys });
        check('Switch to net price (discount cleared)', r.status === 200 && r.body.PricingMode === 'NET' && r.body.DiscountPercent === null && Number(r.body.SellingPrice) === 200);
        r = await api('PUT', `/products/${ids.productId}`, { ...product, PricingMode: 'DISCOUNT', DiscountPercent: 10, Images: ids.imageKeys });
        check('Switch back to 10% discount', r.status === 200 && Number(r.body.SellingPrice) === 180);

        r = await api('POST', `/products/${ids.productId}/stock`, { change: 5, reason: 'RESTOCK', note: 'test restock' });
        check('Restock +5', r.status === 200 && r.body.StockQty === 15);
        r = await api('POST', `/products/${ids.productId}/stock`, { change: -100, reason: 'CORRECTION' });
        check('Stock cannot go below zero', r.status === 409, r.body.message);
        r = await api('GET', `/products/${ids.productId}/stock-ledger`);
        check('Stock history has 2 entries', r.status === 200 && r.body.length === 2);
        r = await api('GET', `/products?q=${encodeURIComponent('ZZ TEST Book')}`);
        check('Product search finds it', r.status === 200 && r.body.some((p) => p.ProductId === ids.productId));

        /* ---------- orders (inserted the way the shop API will) ---------- */
        [{ CustomerId: ids.customerId }] = await customQuery(
            `INSERT INTO dbo.Customers (Name, Mobile, Email, PasswordHash) OUTPUT inserted.CustomerId VALUES ('ZZ TEST Customer', @M, NULL, @H)`,
            { M: `6${String(crypto.randomInt(100000000, 999999999))}`, H: await argon2.hash('x') }
        );
        const makeOrder = async (no, { fulfilment, method, qty, state }) => {
            const subtotal = 180 * qty;
            const shipping = fulfilment === 'DELIVERY' ? 120 : 0;
            const [{ OrderId }] = await customQuery(
                `INSERT INTO dbo.Orders (OrderNo, CustomerId, FulfilmentType, PaymentMethod, ShipName, ShipMobile, ShipLine1, ShipCity, ShipState, ShipPincode, Subtotal, MrpTotal, ShippingCharge, GrandTotal)
                 OUTPUT inserted.OrderId
                 VALUES (@No, @C, @F, @PM, @SN, @SM, @L1, @City, @State, @Pin, @Sub, @Mrp, @Ship, @Grand)`,
                { No: no, C: ids.customerId, F: fulfilment, PM: method, SN: fulfilment === 'DELIVERY' ? 'ZZ TEST' : null, SM: fulfilment === 'DELIVERY' ? '6000000000' : null, L1: fulfilment === 'DELIVERY' ? '1 Test Street' : null, City: fulfilment === 'DELIVERY' ? 'Chennai' : null, State: fulfilment === 'DELIVERY' ? state : null, Pin: fulfilment === 'DELIVERY' ? '600001' : null, Sub: subtotal, Mrp: 200 * qty, Ship: shipping, Grand: subtotal + shipping }
            );
            ids.orders.push(OrderId);
            await customQuery(`INSERT INTO dbo.OrderItems (OrderId, ProductId, Title, Mrp, PricingMode, UnitPrice, GstPercent, HsnCode, Qty) VALUES (@O, @P, 'ZZ TEST Book', 200, 'DISCOUNT', 180, 0, '4901', @Q)`, { O: OrderId, P: ids.productId, Q: qty });
            await customQuery(`UPDATE dbo.Products SET StockQty = StockQty - @Q WHERE ProductId = @P; INSERT INTO dbo.StockLedger (ProductId, Change, QtyAfter, Reason, RefId) SELECT @P, -@Q, StockQty, 'ORDER', @O FROM dbo.Products WHERE ProductId = @P;`, { P: ids.productId, Q: qty, O: OrderId });
            await customQuery(`INSERT INTO dbo.OrderStatusHistory (OrderId, Status, ChangedByType) VALUES (@O, 'PLACED', 'CUSTOMER')`, { O: OrderId });
            return OrderId;
        };

        const o1 = await makeOrder(`ZT-${adminName.slice(-6)}-1`, { fulfilment: 'DELIVERY', method: 'UPI_LATER', qty: 2, state: 'Tamil Nadu' });
        r = await api('GET', `/orders?q=ZT-${adminName.slice(-6)}`);
        check('Orders list finds the new order', r.status === 200 && r.body.length === 1 && r.body[0].Status === 'PLACED');
        await api('POST', `/orders/${o1}/advance`);
        r = await api('POST', `/orders/${o1}/advance`);
        check('Confirm then pack', r.status === 200 && r.body.Status === 'PACKED');
        r = await api('POST', `/orders/${o1}/advance`, {});
        check('Shipping without courier details is refused', r.status === 400);
        r = await api('POST', `/orders/${o1}/advance`, { courierName: 'India Post', trackingNo: 'EB000000000IN' });
        check('Mark shipped issues a GST invoice', r.status === 200 && r.body.Status === 'SHIPPED' && r.body.Invoice?.InvoiceNo, r.body.Invoice?.InvoiceNo);
        const inv1 = await api('GET', `/invoices/${r.body.Invoice.InvoiceId}`);
        check('Out-of-state invoice uses IGST, delivery line kept separate', inv1.status === 200 && inv1.body.IsInterState === true && Number(inv1.body.CgstTotal) === 0 && Number(inv1.body.GrandTotal) === 480 && inv1.body.Lines.length === 1, `grand ${inv1.body.GrandTotal}`);
        check('Invoice number format KBC/YY-YY/NNNN', /^KBC\/\d{2}-\d{2}\/\d{4}$/.test(inv1.body.InvoiceNo), inv1.body.InvoiceNo);
        r = await api('POST', `/orders/${o1}/payments`, { method: 'UPI', amount: 100 });
        check('UPI payment without UTR is refused', r.status === 400);
        r = await api('POST', `/orders/${o1}/payments`, { method: 'UPI', amount: 100, reference: 'UTRTEST1' });
        check('Part payment keeps the order unpaid', r.status === 200 && r.body.PaymentStatus === 'PENDING');
        r = await api('POST', `/orders/${o1}/payments`, { method: 'UPI', reference: 'UTRTEST2' });
        check('Paying the rest marks it paid', r.status === 200 && r.body.PaymentStatus === 'PAID' && r.body.Payments.length === 2);
        r = await api('POST', `/orders/${o1}/advance`);
        check('Mark delivered', r.status === 200 && r.body.Status === 'DELIVERED');
        r = await api('POST', `/orders/${o1}/cancel`, { reason: 'test' });
        check('Delivered order cannot be cancelled', r.status === 409);

        const o2 = await makeOrder(`ZT-${adminName.slice(-6)}-2`, { fulfilment: 'PICKUP', method: 'COD', qty: 3 });
        const [{ StockQty: before }] = await customQuery('SELECT StockQty FROM dbo.Products WHERE ProductId = @P', { P: ids.productId });
        r = await api('POST', `/orders/${o2}/cancel`, {});
        check('Cancel without a reason is refused', r.status === 400);
        r = await api('POST', `/orders/${o2}/cancel`, { reason: 'Customer called to cancel' });
        const [{ StockQty: after }] = await customQuery('SELECT StockQty FROM dbo.Products WHERE ProductId = @P', { P: ids.productId });
        check('Cancel returns stock', r.status === 200 && r.body.Status === 'CANCELLED' && after === before + 3, `${before} → ${after}`);

        const o3 = await makeOrder(`ZT-${adminName.slice(-6)}-3`, { fulfilment: 'PICKUP', method: 'COD', qty: 1 });
        for (let i = 0; i < 3; i += 1) r = await api('POST', `/orders/${o3}/advance`);
        check('Pickup COD handed over: cash recorded, invoice issued, in-state GST', r.status === 200 && r.body.Status === 'PICKED_UP' && r.body.PaymentStatus === 'PAID' && r.body.Invoice, r.body.Status);

        /* ---------- requests ---------- */
        [{ RequestId: ids.requestId }] = await customQuery(
            `INSERT INTO dbo.ProductRequests (RequestNo, CustomerId, RequestType, InstitutionName, ContactName, Mobile, FulfilmentType)
             OUTPUT inserted.RequestId VALUES (@No, @C, 'BULK', 'ZZ TEST School', 'ZZ TEST', '6000000000', 'PICKUP')`,
            { No: `ZR-${adminName.slice(-6)}`, C: ids.customerId }
        );
        await customQuery(`INSERT INTO dbo.ProductRequestItems (RequestId, LineNumber, Title, Qty) VALUES (@R, 1, 'ZZ Test Reader', 40), (@R, 2, 'ZZ Test Notebook', 100)`, { R: ids.requestId });
        await customQuery(`INSERT INTO dbo.RequestStatusHistory (RequestId, Status, ChangedByType) VALUES (@R, 'SUBMITTED', 'CUSTOMER')`, { R: ids.requestId });
        r = await api('POST', `/requests/${ids.requestId}/review`);
        check('Start review', r.status === 200 && r.body.Status === 'UNDER_REVIEW');
        const lines = [{ LineNumber: 1, QuotedUnitPrice: 95, GstPercent: 0, HsnCode: '4901', IsAvailable: true }, { LineNumber: 2, QuotedUnitPrice: 50, GstPercent: 12, HsnCode: '4820', IsAvailable: true }];
        r = await api('PUT', `/requests/${ids.requestId}/quote`, { lines, shipping: 0, validUntil: '2020-01-01' });
        check('Quote with a past date is refused', r.status === 400);
        const valid = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        r = await api('PUT', `/requests/${ids.requestId}/quote`, { lines, shipping: 0, validUntil: valid, note: 'Test quote' });
        check('Send quote (40×95 + 100×50 = 8,800)', r.status === 200 && r.body.Status === 'QUOTED' && Number(r.body.QuoteTotal) === 8800, `total ${r.body.QuoteTotal}`);
        r = await api('POST', `/requests/${ids.requestId}/payments`, { method: 'BANK', reference: 'NEFTTEST' });
        check('Full payment marks paid and issues invoice', r.status === 200 && r.body.Status === 'PAID' && r.body.Invoice, r.body.Status);
        const inv2 = await api('GET', `/invoices/${r.body.Invoice.InvoiceId}`);
        const notebook = inv2.body.Lines?.find((l) => l.Description === 'ZZ Test Notebook');
        check('Request invoice: 12% line split into CGST + SGST', inv2.body.IsInterState === false && notebook && Number(notebook.TaxableValue) === 4464.29 && Number(notebook.Cgst) + Number(notebook.Sgst) === 535.71, notebook ? `${notebook.TaxableValue} + ${notebook.Cgst} + ${notebook.Sgst}` : 'no line');
        await api('POST', `/requests/${ids.requestId}/advance`);
        r = await api('POST', `/requests/${ids.requestId}/advance`);
        check('Ready for pickup, then handed over', r.status === 200 && r.body.Status === 'PICKED_UP');

        /* ---------- customers, dashboard, reports, invoices ---------- */
        r = await api('POST', `/customers/${ids.customerId}/reset-password`);
        check('Reset customer password gives a temporary password', r.status === 200 && /^[a-z]+-\d{4}-[a-z]+$/.test(r.body.temporaryPassword));
        r = await api('PUT', `/customers/${ids.customerId}/active`, { active: false });
        check('Block customer', r.status === 200 && r.body.IsActive === false);
        r = await api('GET', '/dashboard');
        check('Dashboard loads', r.status === 200 && typeof r.body.salesThisMonth === 'number' && Array.isArray(r.body.attention));
        const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
        r = await api('GET', `/reports?from=${today}&to=${today}`);
        check('Report for today includes the test sales', r.status === 200 && r.body.orderCount >= 2 && r.body.gst.length >= 1, `orders ${r.body.orderCount}, sales ${r.body.sales}`);
        r = await api('GET', '/reports?from=2026-12-01&to=2026-01-01');
        check('Report with a reversed range is refused', r.status === 400);
        r = await api('GET', '/invoices');
        check('Invoices list', r.status === 200 && r.body.length >= 3);
        r = await api('GET', '/invoice-years');
        check('Financial years list', r.status === 200 && r.body.length >= 1);
        r = await api('POST', `/categories/${ids.categoryId}/move`, { dir: -1 });
        check('Move category', r.status === 200);
    } catch (error) {
        check('Unexpected error', false, error.stack);
    } finally {
        /* ---------- clean up everything created ---------- */
        try {
            // Safety net: anything carrying the test prefixes, even if its id was never captured.
            const extra = await customQuery(`SELECT OrderId FROM dbo.Orders WHERE OrderNo LIKE 'ZT-%'`);
            extra.forEach((o) => !ids.orders.includes(o.OrderId) && ids.orders.push(o.OrderId));
            const orderList = ids.orders.length ? ids.orders : ['00000000-0000-0000-0000-000000000000'];
            const inList = orderList.map((_, i) => `@O${i}`).join(',');
            const oParams = Object.fromEntries(orderList.map((id, i) => [`O${i}`, id]));
            await customQuery(
                `DELETE l FROM dbo.InvoiceLines l JOIN dbo.Invoices v ON v.InvoiceId = l.InvoiceId WHERE v.OrderId IN (${inList}) OR v.RequestId = @R;
                 DELETE FROM dbo.Invoices WHERE OrderId IN (${inList}) OR RequestId = @R;
                 DELETE FROM dbo.Payments WHERE OrderId IN (${inList}) OR RequestId = @R;
                 DELETE FROM dbo.OrderStatusHistory WHERE OrderId IN (${inList});
                 DELETE FROM dbo.OrderItems WHERE OrderId IN (${inList});
                 DELETE FROM dbo.Orders WHERE OrderId IN (${inList});
                 DELETE FROM dbo.RequestStatusHistory WHERE RequestId = @R;
                 DELETE FROM dbo.ProductRequestItems WHERE RequestId = @R;
                 DELETE FROM dbo.ProductRequests WHERE RequestId = @R;
                 DELETE FROM dbo.StockLedger WHERE ProductId = @P;
                 DELETE FROM dbo.ProductImages WHERE ProductId = @P;
                 DELETE FROM dbo.Products WHERE ProductId = @P;
                 DELETE FROM dbo.Categories WHERE CategoryId = @Cat;
                 DELETE FROM dbo.CustomerAddresses WHERE CustomerId = @C;
                 DELETE FROM dbo.Customers WHERE CustomerId = @C;
                 DELETE FROM dbo.AuditLog WHERE ActorId = @A OR EntityId IN (CAST(@P AS NVARCHAR(60)), CAST(@C AS NVARCHAR(60)), CAST(@Cat AS NVARCHAR(60)), CAST(@R AS NVARCHAR(60)));
                 DELETE FROM dbo.Admins WHERE AdminId = @A;`,
                { ...oParams, R: ids.requestId, P: ids.productId, Cat: ids.categoryId, C: ids.customerId, A: ids.adminId }
            );
            // Invoice counter back to where it was.
            const fyNow = await customQuery('SELECT FinancialYear FROM dbo.InvoiceSequences');
            for (const { FinancialYear } of fyNow) {
                const prev = seqBefore.find((s) => s.FinancialYear === FinancialYear);
                if (prev) await customQuery('UPDATE dbo.InvoiceSequences SET LastNo = @N WHERE FinancialYear = @FY', { N: prev.LastNo, FY: FinancialYear });
                else await customQuery('DELETE FROM dbo.InvoiceSequences WHERE FinancialYear = @FY AND NOT EXISTS (SELECT 1 FROM dbo.Invoices WHERE FinancialYear = @FY)', { FY: FinancialYear });
            }
            for (const key of ids.imageKeys) await fileStore.remove(key).catch(() => null);
            const [left] = await customQuery(
                `SELECT (SELECT COUNT(*) FROM dbo.Products WHERE Title LIKE 'ZZ TEST%') + (SELECT COUNT(*) FROM dbo.Customers WHERE Name LIKE 'ZZ TEST%')
                      + (SELECT COUNT(*) FROM dbo.Admins WHERE UserName LIKE 'zz_test_%') + (SELECT COUNT(*) FROM dbo.Categories WHERE Name LIKE 'ZZ TEST%') AS Leftovers`
            );
            const seqAfter = await customQuery('SELECT FinancialYear, LastNo FROM dbo.InvoiceSequences');
            check('Cleanup: no test rows left, invoice counter restored', left.Leftovers === 0 && JSON.stringify(seqAfter) === JSON.stringify(seqBefore), `leftovers ${left.Leftovers}`);
        } catch (error) {
            check('Cleanup', false, error.message);
        }
        server.close();
        const pool = await db.poolPromise;
        await pool.close();
        const failed = results.filter((x) => !x.ok).length;
        console.log(`\n${results.length - failed}/${results.length} passed`);
        process.exitCode = failed ? 1 : 0;
    }
})();
