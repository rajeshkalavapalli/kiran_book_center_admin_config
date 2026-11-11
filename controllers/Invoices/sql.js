// SQL for GST invoices.
// Query text only: each entry returns the SQL string, and invoiceDA.js runs it (sql.NAME()).
module.exports = {
    // Newest first; @FY is an optional financial year like '26-27'.
    GET_INVOICES: () => {
        return `
            SELECT
                i.InvoiceId,
                i.InvoiceNo,
                i.FinancialYear,
                i.OrderId,
                i.RequestId,
                i.IssuedOn,
                i.BuyerName,
                i.BuyerGstin,
                i.PlaceOfSupply,
                i.IsInterState,
                i.TaxableTotal,
                i.CgstTotal,
                i.SgstTotal,
                i.IgstTotal,
                i.ShippingCharge,
                i.GrandTotal,
                i.IsCancelled,
                COALESCE(o.OrderNo, r.RequestNo) AS SourceNo
            FROM dbo.Invoices i
            LEFT JOIN dbo.Orders o ON o.OrderId = i.OrderId
            LEFT JOIN dbo.ProductRequests r ON r.RequestId = i.RequestId
            WHERE (@FY IS NULL OR i.FinancialYear = @FY)
            ORDER BY i.IssuedOn DESC
        `;
    },

    GET_INVOICE_YEARS: () => {
        return `
            SELECT
                FinancialYear
            FROM dbo.InvoiceSequences
            ORDER BY FinancialYear DESC
        `;
    },

    // Two result sets: the invoice and its lines.
    GET_INVOICE_BY_ID: () => {
        return `
            SELECT
                i.*,
                COALESCE(o.OrderNo, r.RequestNo) AS SourceNo
            FROM dbo.Invoices i
            LEFT JOIN dbo.Orders o ON o.OrderId = i.OrderId
            LEFT JOIN dbo.ProductRequests r ON r.RequestId = i.RequestId
            WHERE i.InvoiceId = @Id;

            SELECT
                LineNumber,
                Description,
                HsnCode,
                Qty,
                UnitPrice,
                GstPercent,
                TaxableValue,
                Cgst,
                Sgst,
                Igst,
                LineTotal
            FROM dbo.InvoiceLines
            WHERE InvoiceId = @Id
            ORDER BY LineNumber;
        `;
    },
};
