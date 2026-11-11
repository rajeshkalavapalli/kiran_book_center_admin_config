// SQL for managing orders: list, order page, status steps, cancelling, payments, invoices.
// Query text only: each entry returns the SQL string, and orderDA.js runs it (sql.NAME()).
module.exports = {
    // Up to 500 orders, newest first. Filters are optional: NULL means "any"; @Status 'OPEN' means not finished.
    GET_ORDERS: () => {
        return `
            SELECT
                o.OrderId,
                o.OrderNo,
                o.CustomerId,
                o.Status,
                o.FulfilmentType,
                o.PaymentMethod,
                o.PaymentStatus,
                o.ShipName,
                o.ShipCity,
                o.ShipState,
                o.Subtotal,
                o.MrpTotal,
                o.ShippingCharge,
                o.GrandTotal,
                o.PlacedOn,
                z.Name AS ZoneName,
                c.Name AS CustomerName,
                c.Mobile AS CustomerMobile
            FROM dbo.Orders o
            JOIN dbo.Customers c ON c.CustomerId = o.CustomerId
            LEFT JOIN dbo.ShippingZones z ON z.ZoneId = o.ShippingZoneId
            WHERE (@Q IS NULL OR o.OrderNo LIKE @Q OR c.Name LIKE @Q OR c.Mobile LIKE @Q OR o.ShipName LIKE @Q)
              AND (@Status IS NULL OR (@Status = 'OPEN' AND o.Status NOT IN ('DELIVERED', 'PICKED_UP', 'CANCELLED')) OR o.Status = @Status)
              AND (@Payment IS NULL OR o.PaymentStatus = @Payment)
              AND (@From IS NULL OR o.PlacedOn >= @From)
              AND (@To IS NULL OR o.PlacedOn < DATEADD(DAY, 1, @To))
            ORDER BY o.PlacedOn DESC
            OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY
        `;
    },

    // Six result sets: the order, items, history, payments, invoice (if issued) and customer.
    GET_ORDER_BY_ID: () => {
        return `
            SELECT
                o.*,
                z.Name AS ZoneName
            FROM dbo.Orders o
            LEFT JOIN dbo.ShippingZones z ON z.ZoneId = o.ShippingZoneId
            WHERE o.OrderId = @Id;

            SELECT
                i.OrderItemId,
                i.ProductId,
                i.Title,
                i.Mrp,
                i.PricingMode,
                i.UnitPrice,
                i.GstPercent,
                i.HsnCode,
                i.Qty,
                i.LineTotal,
                p.Slug,
                p.ProductType,
                p.Author,
                (SELECT TOP 1 StorageKey FROM dbo.ProductImages pi WHERE pi.ProductId = i.ProductId ORDER BY pi.IsPrimary DESC, pi.SortOrder) AS ImageKey
            FROM dbo.OrderItems i
            LEFT JOIN dbo.Products p ON p.ProductId = i.ProductId
            WHERE i.OrderId = @Id
            ORDER BY i.Title;

            SELECT
                Status,
                Note,
                ChangedByType,
                ChangedOn
            FROM dbo.OrderStatusHistory
            WHERE OrderId = @Id
            ORDER BY HistoryId;

            SELECT
                PaymentId,
                Method,
                Direction,
                Amount,
                Reference,
                ReceivedOn,
                Note
            FROM dbo.Payments
            WHERE OrderId = @Id
            ORDER BY ReceivedOn;

            SELECT
                InvoiceId,
                InvoiceNo,
                IssuedOn
            FROM dbo.Invoices
            WHERE OrderId = @Id
              AND IsCancelled = 0;

            SELECT
                c.CustomerId,
                c.Name,
                c.Mobile,
                c.Email
            FROM dbo.Customers c
            JOIN dbo.Orders o ON o.CustomerId = c.CustomerId
            WHERE o.OrderId = @Id;
        `;
    },

    // Locks the order for the rest of the transaction so two clicks can't both change it.
    LOCK_ORDER_BY_ID: () => {
        return `
            SELECT
                OrderId,
                OrderNo,
                Status,
                FulfilmentType,
                PaymentMethod,
                PaymentStatus,
                GrandTotal
            FROM dbo.Orders WITH (UPDLOCK, ROWLOCK)
            WHERE OrderId = @Id
        `;
    },

    UPDATE_ORDER_STATUS: () => {
        return `
            UPDATE dbo.Orders
            SET Status = @Status,
                UpdatedOn = SYSUTCDATETIME()
            WHERE OrderId = @Id
        `;
    },

    UPDATE_ORDER_SHIPPING: () => {
        return `
            UPDATE dbo.Orders
            SET CourierName = @CourierName,
                TrackingNo = @TrackingNo,
                TrackingUrl = @TrackingUrl
            WHERE OrderId = @Id
        `;
    },

    MARK_ORDER_CANCELLED: () => {
        return `
            UPDATE dbo.Orders
            SET Status = 'CANCELLED',
                CancelReason = @Reason,
                UpdatedOn = SYSUTCDATETIME()
            WHERE OrderId = @Id
        `;
    },

    MARK_ORDER_PAID: () => {
        return `
            UPDATE dbo.Orders
            SET PaymentStatus = 'PAID',
                UpdatedOn = SYSUTCDATETIME()
            WHERE OrderId = @Id
        `;
    },

    GET_ORDER_ITEMS: () => {
        return `
            SELECT
                ProductId,
                Qty
            FROM dbo.OrderItems
            WHERE OrderId = @Id
        `;
    },

    INSERT_ORDER_HISTORY: () => {
        return `
            INSERT INTO dbo.OrderStatusHistory (
                OrderId,
                Status,
                Note,
                ChangedByType,
                ChangedById
            ) VALUES (
                @Id,
                @Status,
                @Note,
                'ADMIN',
                @AdminId
            )
        `;
    },

    // Money received so far (payments in minus refunds out).
    GET_ORDER_PAID_SO_FAR: () => {
        return `
            SELECT
                ISNULL(SUM(CASE WHEN Direction = 'IN' THEN Amount ELSE -Amount END), 0) AS Paid
            FROM dbo.Payments
            WHERE OrderId = @Id
        `;
    },

    INSERT_ORDER_PAYMENT: () => {
        return `
            INSERT INTO dbo.Payments (
                OrderId,
                RequestId,
                Method,
                Direction,
                Amount,
                Reference,
                ReceivedOn,
                RecordedBy,
                Note
            ) VALUES (
                @OrderId,
                NULL,
                @Method,
                'IN',
                @Amount,
                @Reference,
                @ReceivedOn,
                @AdminId,
                @Note
            )
        `;
    },

    CANCEL_ORDER_INVOICES: () => {
        return `
            UPDATE dbo.Invoices
            SET IsCancelled = 1
            WHERE OrderId = @Id
        `;
    },
};
