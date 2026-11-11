// SQL for managing book requests and bulk enquiries: list, request page, quote, reject, payments, dispatch.
// Query text only: each entry returns the SQL string, and requestDA.js runs it (sql.NAME()).
module.exports = {
    // Up to 500 requests, newest first. Filters are optional: NULL means "any"; @Status 'OPEN' means not finished.
    GET_REQUESTS: () => {
        return `
            SELECT
                r.RequestId,
                r.RequestNo,
                r.CustomerId,
                r.RequestType,
                r.InstitutionName,
                r.ContactName,
                r.Mobile,
                r.Status,
                r.PaymentStatus,
                r.QuoteTotal,
                r.AcceptedOn,
                r.CreatedOn,
                c.Name AS CustomerName,
                (SELECT COUNT(*) FROM dbo.ProductRequestItems i WHERE i.RequestId = r.RequestId) AS ItemCount,
                (SELECT TOP 1 Title FROM dbo.ProductRequestItems i WHERE i.RequestId = r.RequestId ORDER BY LineNumber) AS FirstTitle
            FROM dbo.ProductRequests r
            JOIN dbo.Customers c ON c.CustomerId = r.CustomerId
            WHERE (@Q IS NULL OR r.RequestNo LIKE @Q OR r.ContactName LIKE @Q OR r.InstitutionName LIKE @Q OR r.Mobile LIKE @Q
                   OR EXISTS (SELECT 1 FROM dbo.ProductRequestItems i WHERE i.RequestId = r.RequestId AND i.Title LIKE @Q))
              AND (@Status IS NULL OR (@Status = 'OPEN' AND r.Status NOT IN ('DELIVERED', 'PICKED_UP', 'REJECTED', 'CANCELLED')) OR r.Status = @Status)
              AND (@Type IS NULL OR r.RequestType = @Type)
            ORDER BY r.CreatedOn DESC
            OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY
        `;
    },

    // Seven result sets: the request, lines, history, payments, invoice (if issued), customer and attachments.
    GET_REQUEST_BY_ID: () => {
        return `
            SELECT
                *
            FROM dbo.ProductRequests
            WHERE RequestId = @Id;

            SELECT
                i.RequestItemId,
                i.LineNumber,
                i.Title,
                i.Author,
                i.Publisher,
                i.ClassLevel,
                i.Qty,
                i.QuotedUnitPrice,
                i.GstPercent,
                i.HsnCode,
                i.IsAvailable,
                i.LinkedProductId,
                p.Title AS LinkedProductTitle
            FROM dbo.ProductRequestItems i
            LEFT JOIN dbo.Products p ON p.ProductId = i.LinkedProductId
            WHERE i.RequestId = @Id
            ORDER BY i.LineNumber;

            SELECT
                Status,
                Note,
                ChangedByType,
                ChangedOn
            FROM dbo.RequestStatusHistory
            WHERE RequestId = @Id
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
            WHERE RequestId = @Id
            ORDER BY ReceivedOn;

            SELECT
                InvoiceId,
                InvoiceNo,
                IssuedOn
            FROM dbo.Invoices
            WHERE RequestId = @Id
              AND IsCancelled = 0;

            SELECT
                c.CustomerId,
                c.Name,
                c.Mobile,
                c.Email
            FROM dbo.Customers c
            JOIN dbo.ProductRequests r ON r.CustomerId = c.CustomerId
            WHERE r.RequestId = @Id;

            SELECT
                AttachmentId,
                StorageKey,
                FileName,
                ContentType,
                SizeBytes
            FROM dbo.RequestAttachments
            WHERE RequestId = @Id
            ORDER BY CreatedOn;
        `;
    },

    // Locks the request for the rest of the transaction so two clicks can't both change it.
    LOCK_REQUEST_BY_ID: () => {
        return `
            SELECT
                RequestId,
                RequestNo,
                Status,
                FulfilmentType,
                QuoteTotal,
                AcceptedOn
            FROM dbo.ProductRequests WITH (UPDLOCK, ROWLOCK)
            WHERE RequestId = @Id
        `;
    },

    GET_REQUEST_ITEMS: () => {
        return `
            SELECT
                LineNumber,
                Qty
            FROM dbo.ProductRequestItems
            WHERE RequestId = @Id
        `;
    },

    UPDATE_REQUEST_ITEM_QUOTE: () => {
        return `
            UPDATE dbo.ProductRequestItems
            SET IsAvailable = @IsAvailable,
                QuotedUnitPrice = @Price,
                GstPercent = @GstPercent,
                HsnCode = @HsnCode
            WHERE RequestId = @Id
              AND LineNumber = @LineNumber
        `;
    },

    UPDATE_REQUEST_QUOTE: () => {
        return `
            UPDATE dbo.ProductRequests
            SET Status = 'QUOTED',
                QuoteItemsTotal = @ItemsTotal,
                QuoteShipping = @Shipping,
                QuoteTotal = @Total,
                QuoteValidUntil = @ValidUntil,
                QuoteNote = @Note,
                QuotedOn = SYSUTCDATETIME(),
                UpdatedOn = SYSUTCDATETIME()
            WHERE RequestId = @Id
        `;
    },

    UPDATE_REQUEST_STATUS: () => {
        return `
            UPDATE dbo.ProductRequests
            SET Status = @Status,
                UpdatedOn = SYSUTCDATETIME()
            WHERE RequestId = @Id
        `;
    },

    MARK_REQUEST_REJECTED: () => {
        return `
            UPDATE dbo.ProductRequests
            SET Status = 'REJECTED',
                RejectReason = @Reason,
                UpdatedOn = SYSUTCDATETIME()
            WHERE RequestId = @Id
        `;
    },

    // Paid in full: also counts as accepted if the customer hadn't clicked "Accept" online.
    MARK_REQUEST_PAID: () => {
        return `
            UPDATE dbo.ProductRequests
            SET Status = 'PAID',
                PaymentStatus = 'PAID',
                AcceptedOn = ISNULL(AcceptedOn, SYSUTCDATETIME()),
                UpdatedOn = SYSUTCDATETIME()
            WHERE RequestId = @Id
        `;
    },

    UPDATE_REQUEST_SHIPPING: () => {
        return `
            UPDATE dbo.ProductRequests
            SET CourierName = @CourierName,
                TrackingNo = @TrackingNo,
                TrackingUrl = @TrackingUrl
            WHERE RequestId = @Id
        `;
    },

    INSERT_REQUEST_HISTORY: () => {
        return `
            INSERT INTO dbo.RequestStatusHistory (
                RequestId,
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
    GET_REQUEST_PAID_SO_FAR: () => {
        return `
            SELECT
                ISNULL(SUM(CASE WHEN Direction = 'IN' THEN Amount ELSE -Amount END), 0) AS Paid
            FROM dbo.Payments
            WHERE RequestId = @Id
        `;
    },

    INSERT_REQUEST_PAYMENT: () => {
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
                NULL,
                @Id,
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

    GET_REQUEST_ATTACHMENT: () => {
        return `
            SELECT
                StorageKey,
                FileName,
                ContentType
            FROM dbo.RequestAttachments
            WHERE AttachmentId = @AttachmentId
              AND RequestId = @Id
        `;
    },
};
