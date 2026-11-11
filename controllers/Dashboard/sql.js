// SQL for the dashboard and the reports page.
// Query text only: each entry returns the SQL string, and dashboardDA.js runs it (sql.NAME()).
// Dates are India time: the database stores UTC, so PlacedOn is shifted to +05:30 before taking the date.

const IST_DATE = (column) => `CAST(SWITCHOFFSET(${column}, '+05:30') AS DATE)`;

module.exports = {
    // Eight result sets: KPIs, low stock, needs attention, recent orders, sales per day (14 days),
    // open-order pipeline, this month vs last month, top sellers this month.
    GET_DASHBOARD: () => {
        return `
            DECLARE @Now DATETIMEOFFSET = SWITCHOFFSET(SYSUTCDATETIME(), '+05:30');
            DECLARE @Today DATE = CAST(@Now AS DATE);
            DECLARE @MonthStart DATE = DATEFROMPARTS(YEAR(@Today), MONTH(@Today), 1);
            DECLARE @LastMonthStart DATE = DATEADD(MONTH, -1, @MonthStart);
            DECLARE @LastMonthSameDay DATE = DATEADD(MONTH, -1, DATEADD(DAY, 1, @Today));

            -- 1. KPIs
            SELECT
                (SELECT COUNT(*) FROM dbo.Orders WHERE ${IST_DATE('PlacedOn')} = @Today) AS TodayOrders,
                (SELECT COUNT(*) FROM dbo.Orders WHERE Status = 'PLACED') AS ToConfirm,
                (SELECT COUNT(*) FROM dbo.Orders WHERE Status <> 'CANCELLED' AND PaymentStatus = 'PENDING' AND PaymentMethod = 'UPI_LATER')
                  + (SELECT COUNT(*) FROM dbo.ProductRequests WHERE Status = 'QUOTED' AND AcceptedOn IS NOT NULL) AS PaymentsPending,
                (SELECT COUNT(*) FROM dbo.ProductRequests WHERE Status IN ('SUBMITTED', 'UNDER_REVIEW')) AS NewRequests,
                (SELECT ISNULL(SUM(GrandTotal), 0) FROM dbo.Orders
                  WHERE Status <> 'CANCELLED' AND ${IST_DATE('PlacedOn')} >= @MonthStart) AS SalesThisMonth,
                (SELECT ISNULL(SUM(GrandTotal), 0) FROM dbo.Orders
                  WHERE Status <> 'CANCELLED' AND ${IST_DATE('PlacedOn')} >= @LastMonthStart AND ${IST_DATE('PlacedOn')} < @LastMonthSameDay) AS SalesLastMonthToDate;

            -- 2. Low stock
            SELECT
                ProductId,
                Title,
                StockQty,
                LowStockAt
            FROM dbo.Products
            WHERE IsActive = 1
              AND StockQty <= LowStockAt
            ORDER BY StockQty, Title;

            -- 3. Needs attention
            SELECT
                kind,
                id,
                no,
                text,
                amount,
                onDate
            FROM (
                SELECT 'order' AS kind, OrderId AS id, OrderNo AS no, 'New order to confirm' AS text, GrandTotal AS amount, PlacedOn AS onDate
                FROM dbo.Orders
                WHERE Status = 'PLACED'
                UNION ALL
                SELECT 'order', OrderId, OrderNo, 'UPI payment not recorded', GrandTotal, PlacedOn
                FROM dbo.Orders
                WHERE Status NOT IN ('PLACED', 'CANCELLED') AND PaymentStatus = 'PENDING' AND PaymentMethod = 'UPI_LATER'
                UNION ALL
                SELECT 'request', RequestId, RequestNo,
                       CASE WHEN RequestType = 'BULK' THEN 'Bulk enquiry: ' + ISNULL(InstitutionName, '') ELSE 'Book request to quote' END,
                       NULL, CreatedOn
                FROM dbo.ProductRequests
                WHERE Status IN ('SUBMITTED', 'UNDER_REVIEW')
                UNION ALL
                SELECT 'request', RequestId, RequestNo, 'Quote accepted, waiting for payment', QuoteTotal, AcceptedOn
                FROM dbo.ProductRequests
                WHERE Status = 'QUOTED' AND AcceptedOn IS NOT NULL
            ) a
            ORDER BY onDate;

            -- 4. Recent orders
            SELECT TOP 6
                o.OrderId,
                o.OrderNo,
                o.Status,
                o.PaymentStatus,
                o.GrandTotal,
                o.PlacedOn,
                c.Name AS CustomerName
            FROM dbo.Orders o
            JOIN dbo.Customers c ON c.CustomerId = o.CustomerId
            ORDER BY o.PlacedOn DESC;

            -- 5. Sales per day for the last 14 days
            SELECT
                CONVERT(CHAR(10), ${IST_DATE('PlacedOn')}, 23) AS date,
                COUNT(*) AS orders,
                SUM(GrandTotal) AS total
            FROM dbo.Orders
            WHERE Status <> 'CANCELLED'
              AND ${IST_DATE('PlacedOn')} > DATEADD(DAY, -14, @Today)
            GROUP BY ${IST_DATE('PlacedOn')};

            -- 6. Open-order pipeline
            SELECT
                Status,
                COUNT(*) AS N
            FROM dbo.Orders
            WHERE Status IN ('PLACED', 'CONFIRMED', 'PACKED', 'READY_FOR_PICKUP', 'SHIPPED')
            GROUP BY Status;

            -- 7. This month vs the same days last month
            SELECT
                (SELECT COUNT(*) FROM dbo.Orders
                  WHERE Status <> 'CANCELLED' AND ${IST_DATE('PlacedOn')} >= @MonthStart) AS OrdersThisMonth,
                (SELECT AVG(GrandTotal) FROM dbo.Orders
                  WHERE Status <> 'CANCELLED' AND ${IST_DATE('PlacedOn')} >= @MonthStart) AS AvgThisMonth,
                (SELECT COUNT(*) FROM dbo.Orders
                  WHERE Status <> 'CANCELLED' AND ${IST_DATE('PlacedOn')} >= @LastMonthStart AND ${IST_DATE('PlacedOn')} < @LastMonthSameDay) AS OrdersLastMonthToDate,
                (SELECT AVG(GrandTotal) FROM dbo.Orders
                  WHERE Status <> 'CANCELLED' AND ${IST_DATE('PlacedOn')} >= @LastMonthStart AND ${IST_DATE('PlacedOn')} < @LastMonthSameDay) AS AvgLastMonth,
                (SELECT ISNULL(SUM(GrandTotal), 0) FROM dbo.Orders WHERE Status <> 'CANCELLED' AND PaymentStatus = 'PENDING')
                  + (SELECT ISNULL(SUM(QuoteTotal), 0) FROM dbo.ProductRequests WHERE Status = 'QUOTED' AND AcceptedOn IS NOT NULL) AS PendingAmount;

            -- 8. Top sellers this month
            SELECT TOP 5
                i.ProductId,
                MAX(i.Title) AS Title,
                MAX(p.ProductType) AS ProductType,
                SUM(i.Qty) AS qty,
                SUM(i.LineTotal) AS total
            FROM dbo.OrderItems i
            JOIN dbo.Orders o ON o.OrderId = i.OrderId
            LEFT JOIN dbo.Products p ON p.ProductId = i.ProductId
            WHERE o.Status <> 'CANCELLED'
              AND ${IST_DATE('o.PlacedOn')} >= @MonthStart
            GROUP BY i.ProductId
            ORDER BY total DESC;
        `;
    },

    // Eight result sets for @From..@To (India dates): totals, sales per day, items sold, sales by category,
    // best sellers, payment split, GST summary by rate, invoice count.
    GET_REPORT: () => {
        return `
            DECLARE @FromD DATE = @From, @ToD DATE = @To;

            -- 1. Totals
            SELECT
                COUNT(*) AS OrderCount,
                ISNULL(SUM(GrandTotal), 0) AS Sales,
                ISNULL(SUM(MrpTotal - Subtotal), 0) AS SavingsGiven
            FROM dbo.Orders
            WHERE Status <> 'CANCELLED'
              AND ${IST_DATE('PlacedOn')} BETWEEN @FromD AND @ToD;

            -- 2. Sales per day
            SELECT
                CONVERT(CHAR(10), ${IST_DATE('PlacedOn')}, 23) AS date,
                COUNT(*) AS orders,
                SUM(GrandTotal) AS total
            FROM dbo.Orders
            WHERE Status <> 'CANCELLED'
              AND ${IST_DATE('PlacedOn')} BETWEEN @FromD AND @ToD
            GROUP BY ${IST_DATE('PlacedOn')};

            -- 3. Items sold
            SELECT
                ISNULL(SUM(i.Qty), 0) AS ItemsSold
            FROM dbo.OrderItems i
            JOIN dbo.Orders o ON o.OrderId = i.OrderId
            WHERE o.Status <> 'CANCELLED'
              AND ${IST_DATE('o.PlacedOn')} BETWEEN @FromD AND @ToD;

            -- 4. Sales by top-level category
            SELECT
                ISNULL(top_c.Name, c.Name) AS name,
                SUM(i.Qty) AS qty,
                SUM(i.LineTotal) AS total
            FROM dbo.OrderItems i
            JOIN dbo.Orders o ON o.OrderId = i.OrderId
            JOIN dbo.Products p ON p.ProductId = i.ProductId
            JOIN dbo.Categories c ON c.CategoryId = p.CategoryId
            LEFT JOIN dbo.Categories top_c ON top_c.CategoryId = c.ParentCategoryId
            WHERE o.Status <> 'CANCELLED'
              AND ${IST_DATE('o.PlacedOn')} BETWEEN @FromD AND @ToD
            GROUP BY ISNULL(top_c.Name, c.Name)
            ORDER BY total DESC;

            -- 5. Best sellers
            SELECT TOP 10
                i.Title AS title,
                SUM(i.Qty) AS qty,
                SUM(i.LineTotal) AS total
            FROM dbo.OrderItems i
            JOIN dbo.Orders o ON o.OrderId = i.OrderId
            WHERE o.Status <> 'CANCELLED'
              AND ${IST_DATE('o.PlacedOn')} BETWEEN @FromD AND @ToD
            GROUP BY i.ProductId, i.Title
            ORDER BY total DESC;

            -- 6. Payment split
            SELECT
                PaymentMethod AS method,
                COUNT(*) AS count,
                SUM(GrandTotal) AS total
            FROM dbo.Orders
            WHERE Status <> 'CANCELLED'
              AND ${IST_DATE('PlacedOn')} BETWEEN @FromD AND @ToD
            GROUP BY PaymentMethod
            ORDER BY total DESC;

            -- 7. GST summary by rate (from issued invoices)
            SELECT
                l.GstPercent AS rate,
                SUM(l.TaxableValue) AS taxable,
                SUM(l.Cgst) AS cgst,
                SUM(l.Sgst) AS sgst,
                SUM(l.Igst) AS igst,
                SUM(l.LineTotal) AS total
            FROM dbo.InvoiceLines l
            JOIN dbo.Invoices v ON v.InvoiceId = l.InvoiceId
            WHERE v.IsCancelled = 0
              AND ${IST_DATE('v.IssuedOn')} BETWEEN @FromD AND @ToD
            GROUP BY l.GstPercent
            ORDER BY l.GstPercent;

            -- 8. Invoice count
            SELECT
                COUNT(*) AS InvoiceCount
            FROM dbo.Invoices
            WHERE IsCancelled = 0
              AND ${IST_DATE('IssuedOn')} BETWEEN @FromD AND @ToD;
        `;
    },
};
