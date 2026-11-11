// Shared business helpers: settings, audit, GST split, invoice issuing, stock moves.
const { customQuery } = require('./dbFunctions');
const { fail, money } = require('./access');

/* ---------------- settings ---------------- */
// dbo.ShopSettings as { 'shop.name': '...', ... }. Pass a transaction runner to read inside one.
const loadSettings = async (tx) => {
    const run = tx ? tx.run : customQuery;
    const rows = await run('SELECT SettingKey, SettingValue FROM dbo.ShopSettings');
    return Object.fromEntries(rows.map((r) => [r.SettingKey, r.SettingValue]));
};

/* ---------------- audit ---------------- */
// Who did what. A failure here is logged, never thrown.
const audit = async ({ actorId = null, action, entityType = null, entityId = null, details = null }) => {
    try {
        await customQuery(
            `INSERT INTO dbo.AuditLog (ActorType, ActorId, Action, EntityType, EntityId, Details)
             VALUES ('ADMIN', @ActorId, @Action, @EntityType, @EntityId, @Details)`,
            { ActorId: actorId, Action: action, EntityType: entityType, EntityId: entityId == null ? null : String(entityId), Details: details == null ? null : JSON.stringify(details) }
        );
    } catch (error) {
        console.error(`Audit not recorded (${action}):`, error.message);
    }
};

/* ---------------- stock ---------------- */
// Moves stock and writes the ledger in the same transaction. Refuses to go below zero.
const moveStock = async (tx, { productId, change, reason, refId = null, note = null, adminId = null }) => {
    const [row] = await tx.run(
        `UPDATE dbo.Products SET StockQty = StockQty + @Change, UpdatedOn = SYSUTCDATETIME()
         OUTPUT inserted.StockQty, inserted.Title
         WHERE ProductId = @ProductId AND StockQty + @Change >= 0`,
        { ProductId: productId, Change: change }
    );
    if (!row) {
        const [p] = await tx.run('SELECT Title, StockQty FROM dbo.Products WHERE ProductId = @ProductId', { ProductId: productId });
        throw fail(409, p ? `Not enough stock of "${p.Title}" (${p.StockQty} left).` : 'Product not found.');
    }
    await tx.run(
        `INSERT INTO dbo.StockLedger (ProductId, Change, QtyAfter, Reason, RefId, Note, CreatedBy)
         VALUES (@ProductId, @Change, @QtyAfter, @Reason, @RefId, @Note, @CreatedBy)`,
        { ProductId: productId, Change: change, QtyAfter: row.StockQty, Reason: reason, RefId: refId, Note: note, CreatedBy: adminId }
    );
    return row.StockQty;
};

/* ---------------- GST ----------------
   Prices are GST-inclusive. Per line: taxable = total ÷ (1 + rate); tax = total − taxable.
   Same state as the shop → CGST + SGST (half each); otherwise IGST. */
const gstSplit = (lineTotal, rate, interState) => {
    const taxable = money(lineTotal / (1 + Number(rate) / 100));
    const tax = money(lineTotal - taxable);
    if (interState) return { TaxableValue: taxable, Cgst: 0, Sgst: 0, Igst: tax };
    const half = money(tax / 2);
    return { TaxableValue: taxable, Cgst: half, Sgst: money(tax - half), Igst: 0 };
};

const financialYear = (date = new Date()) => {
    const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
    return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
};

/**
 * Issues the GST invoice for an order or a request inside the caller's transaction.
 * Returns the existing live invoice when there already is one (never two per order).
 * Invoice numbers come from dbo.InvoiceSequences under an update lock, so they are gap-free.
 *   source: { kind: 'order'|'request', id }
 * Delivery charges are shown as a separate line without GST. [Confirm with the shop's accountant.]
 */
const issueInvoice = async (tx, { kind, id }) => {
    const ownerCol = kind === 'order' ? 'OrderId' : 'RequestId';
    const [existing] = await tx.run(`SELECT InvoiceId FROM dbo.Invoices WITH (UPDLOCK, HOLDLOCK) WHERE ${ownerCol} = @Id AND IsCancelled = 0`, { Id: id });
    if (existing) return existing.InvoiceId;

    const s = await loadSettings(tx);
    let head;
    let lines;
    if (kind === 'order') {
        [head] = await tx.run(
            `SELECT o.OrderNo AS SourceNo, o.FulfilmentType, o.ShipName, o.ShipMobile, o.ShipLine1, o.ShipLine2, o.ShipCity, o.ShipState, o.ShipPincode,
                    o.ShippingCharge, c.Name AS CustomerName, c.Mobile AS CustomerMobile, NULL AS InstitutionName, NULL AS InstitutionGstin
             FROM dbo.Orders o JOIN dbo.Customers c ON c.CustomerId = o.CustomerId WHERE o.OrderId = @Id`,
            { Id: id }
        );
        lines = await tx.run('SELECT Title AS Description, HsnCode, Qty, UnitPrice, GstPercent FROM dbo.OrderItems WHERE OrderId = @Id ORDER BY Title', { Id: id });
    } else {
        [head] = await tx.run(
            `SELECT r.RequestNo AS SourceNo, r.FulfilmentType, r.ShipName, r.ShipMobile, r.ShipLine1, r.ShipLine2, r.ShipCity, r.ShipState, r.ShipPincode,
                    ISNULL(r.QuoteShipping, 0) AS ShippingCharge, c.Name AS CustomerName, c.Mobile AS CustomerMobile, r.InstitutionName, r.InstitutionGstin
             FROM dbo.ProductRequests r JOIN dbo.Customers c ON c.CustomerId = r.CustomerId WHERE r.RequestId = @Id`,
            { Id: id }
        );
        lines = await tx.run(
            `SELECT Title AS Description, HsnCode, Qty, QuotedUnitPrice AS UnitPrice, ISNULL(GstPercent, 0) AS GstPercent
             FROM dbo.ProductRequestItems WHERE RequestId = @Id AND ISNULL(IsAvailable, 1) = 1 AND QuotedUnitPrice IS NOT NULL ORDER BY LineNumber`,
            { Id: id }
        );
    }
    if (!head) throw fail(404, 'Not found.');
    if (!lines.length) throw fail(409, 'There is nothing to invoice.');

    const shopState = s['shop.state'];
    const placeOfSupply = head.FulfilmentType === 'PICKUP' || !head.ShipState ? shopState : head.ShipState;
    const inter = placeOfSupply !== shopState;
    const fy = financialYear();

    await tx.run(
        `IF NOT EXISTS (SELECT 1 FROM dbo.InvoiceSequences WITH (UPDLOCK, HOLDLOCK) WHERE FinancialYear = @FY)
             INSERT INTO dbo.InvoiceSequences (FinancialYear, LastNo) VALUES (@FY, 0);`,
        { FY: fy }
    );
    const [seq] = await tx.run('UPDATE dbo.InvoiceSequences SET LastNo = LastNo + 1 OUTPUT inserted.LastNo WHERE FinancialYear = @FY', { FY: fy });
    const invoiceNo = `${s['gst.invoicePrefix'] || 'KBC'}/${fy}/${String(seq.LastNo).padStart(4, '0')}`;

    const computed = lines.map((l, i) => {
        const total = money(Number(l.UnitPrice) * l.Qty);
        return { LineNumber: i + 1, ...l, ...gstSplit(total, l.GstPercent, inter), LineTotal: total };
    });
    const sum = (k) => money(computed.reduce((n, l) => n + l[k], 0));
    const shipping = money(head.ShippingCharge);
    const address = head.ShipLine1 ? [head.ShipLine1, head.ShipLine2, `${head.ShipCity}, ${head.ShipState} ${head.ShipPincode}`].filter(Boolean).join(', ') : null;
    const sellerAddress = [s['shop.addressLine1'], s['shop.addressLine2'], `${s['shop.city'] || ''}, ${shopState || ''} ${s['shop.pincode'] || ''}`].filter(Boolean).join(', ');

    const [inv] = await tx.run(
        `INSERT INTO dbo.Invoices (InvoiceNo, FinancialYear, OrderId, RequestId, SellerName, SellerAddress, SellerGstin, SellerState, SellerStateCode,
             BuyerName, BuyerMobile, BuyerAddress, BuyerGstin, PlaceOfSupply, IsInterState, TaxableTotal, CgstTotal, SgstTotal, IgstTotal, ShippingCharge, RoundOff, GrandTotal)
         OUTPUT inserted.InvoiceId
         VALUES (@InvoiceNo, @FY, @OrderId, @RequestId, @SellerName, @SellerAddress, @SellerGstin, @SellerState, @SellerStateCode,
             @BuyerName, @BuyerMobile, @BuyerAddress, @BuyerGstin, @PlaceOfSupply, @IsInterState, @Taxable, @Cgst, @Sgst, @Igst, @Shipping, 0, @Grand)`,
        {
            InvoiceNo: invoiceNo,
            FY: fy,
            OrderId: kind === 'order' ? id : null,
            RequestId: kind === 'request' ? id : null,
            SellerName: String(s['shop.name'] || 'Kiran Book Center').slice(0, 200),
            SellerAddress: sellerAddress.slice(0, 500),
            // Only a well-formed GSTIN goes on the invoice (a placeholder setting stays off it).
            SellerGstin: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(s['gst.gstin'] || '').trim().toUpperCase()) ? s['gst.gstin'].trim().toUpperCase() : null,
            SellerState: String(shopState || '').slice(0, 60),
            SellerStateCode: /^\d{2}$/.test(String(s['shop.stateCode'] || '')) ? s['shop.stateCode'] : null,
            BuyerName: head.InstitutionName || head.CustomerName || head.ShipName,
            BuyerMobile: head.CustomerMobile,
            BuyerAddress: address,
            BuyerGstin: head.InstitutionGstin || null,
            PlaceOfSupply: placeOfSupply || '',
            IsInterState: inter,
            Taxable: sum('TaxableValue'),
            Cgst: sum('Cgst'),
            Sgst: sum('Sgst'),
            Igst: sum('Igst'),
            Shipping: shipping,
            Grand: money(sum('LineTotal') + shipping),
        }
    );
    for (const l of computed) {
        await tx.run(
            `INSERT INTO dbo.InvoiceLines (InvoiceId, LineNumber, Description, HsnCode, Qty, UnitPrice, GstPercent, TaxableValue, Cgst, Sgst, Igst, LineTotal)
             VALUES (@InvoiceId, @LineNumber, @Description, @HsnCode, @Qty, @UnitPrice, @GstPercent, @TaxableValue, @Cgst, @Sgst, @Igst, @LineTotal)`,
            { InvoiceId: inv.InvoiceId, ...l }
        );
    }
    return inv.InvoiceId;
};

module.exports = { loadSettings, audit, moveStock, gstSplit, financialYear, issueInvoice };
