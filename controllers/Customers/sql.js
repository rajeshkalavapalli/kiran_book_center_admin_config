// SQL for the customer list, customer page, password reset and blocking.
// Query text only: each entry returns the SQL string, and customerDA.js runs it (sql.NAME()).
module.exports = {
    // Newest activity first; @Q is an optional search on name, mobile or email.
    GET_CUSTOMERS: () => {
        return `
            SELECT
                c.CustomerId,
                c.Name,
                c.Mobile,
                c.Email,
                c.IsActive,
                c.CreatedOn,
                ISNULL(s.OrderCount, 0) AS OrderCount,
                ISNULL(s.TotalSpent, 0) AS TotalSpent,
                s.LastOrderOn,
                (SELECT COUNT(*) FROM dbo.ProductRequests r WHERE r.CustomerId = c.CustomerId) AS RequestCount
            FROM dbo.Customers c
            OUTER APPLY (
                SELECT
                    COUNT(*) AS OrderCount,
                    SUM(o.GrandTotal) AS TotalSpent,
                    MAX(o.PlacedOn) AS LastOrderOn
                FROM dbo.Orders o
                WHERE o.CustomerId = c.CustomerId
                  AND o.Status <> 'CANCELLED'
            ) s
            WHERE (@Q IS NULL OR c.Name LIKE @Q OR c.Mobile LIKE @Q OR c.Email LIKE @Q)
            ORDER BY ISNULL(s.LastOrderOn, c.CreatedOn) DESC
            OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY
        `;
    },

    // Four result sets: the customer, their addresses, orders and requests.
    GET_CUSTOMER_BY_ID: () => {
        return `
            SELECT
                CustomerId,
                Name,
                Mobile,
                Email,
                IsActive,
                MustChangePassword,
                CreatedOn,
                LastLoginOn
            FROM dbo.Customers
            WHERE CustomerId = @Id;

            SELECT
                AddressId,
                Name,
                Mobile,
                Line1,
                Line2,
                Landmark,
                City,
                State,
                Pincode,
                IsDefault
            FROM dbo.CustomerAddresses
            WHERE CustomerId = @Id
            ORDER BY IsDefault DESC, CreatedOn;

            SELECT
                OrderId,
                OrderNo,
                Status,
                PaymentStatus,
                GrandTotal,
                PlacedOn
            FROM dbo.Orders
            WHERE CustomerId = @Id
            ORDER BY PlacedOn DESC;

            SELECT
                r.RequestId,
                r.RequestNo,
                r.RequestType,
                r.InstitutionName,
                r.Status,
                r.QuoteTotal,
                r.CreatedOn,
                (SELECT TOP 1 Title FROM dbo.ProductRequestItems i WHERE i.RequestId = r.RequestId ORDER BY LineNumber) AS FirstTitle
            FROM dbo.ProductRequests r
            WHERE r.CustomerId = @Id
            ORDER BY r.CreatedOn DESC;
        `;
    },

    GET_CUSTOMER_CONTACT: () => {
        return `
            SELECT
                Name,
                Mobile
            FROM dbo.Customers
            WHERE CustomerId = @Id
        `;
    },

    // The customer must choose a new password at the next sign-in.
    UPDATE_CUSTOMER_PASSWORD: () => {
        return `
            UPDATE dbo.Customers
            SET PasswordHash = @Hash,
                MustChangePassword = 1
            WHERE CustomerId = @Id
        `;
    },

    UPDATE_CUSTOMER_ACTIVE: () => {
        return `
            UPDATE dbo.Customers
            SET IsActive = @Active
            WHERE CustomerId = @Id
        `;
    },
};
