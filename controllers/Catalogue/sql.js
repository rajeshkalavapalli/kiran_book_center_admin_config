// SQL for categories, products, product photos and stock history.
// Query text only: each entry returns the SQL string, and catalogueDA.js runs it (sql.NAME()).

// Shared column list for product queries.
const PRODUCT_COLUMNS = `
                p.ProductId,
                p.Sku,
                p.ProductType,
                p.CategoryId,
                p.Title,
                p.Slug,
                p.Author,
                p.Publisher,
                p.Isbn,
                p.Edition,
                p.PublishYear,
                p.Language,
                p.ClassLevel,
                p.Board,
                p.Subject,
                p.Description,
                p.Mrp,
                p.PricingMode,
                p.DiscountPercent,
                p.NetPrice,
                p.SellingPrice,
                p.GstPercent,
                p.HsnCode,
                p.StockQty,
                p.LowStockAt,
                p.WeightGrams,
                p.IsFeatured,
                p.IsActive,
                p.CreatedOn,
                p.UpdatedOn`;

// Siblings: categories with the same parent (both top-level when @ParentCategoryId is NULL).
const SAME_PARENT = `(ParentCategoryId IS NULL AND @ParentCategoryId IS NULL) OR ParentCategoryId = @ParentCategoryId`;

module.exports = {
    /* ---------------- categories ---------------- */

    GET_CATEGORIES: () => {
        return `
            SELECT
                CategoryId,
                ParentCategoryId,
                Name,
                Slug,
                Description,
                SortOrder,
                IsActive
            FROM dbo.Categories
            ORDER BY SortOrder, Name
        `;
    },

    GET_CATEGORY_BY_ID: () => {
        return `
            SELECT
                CategoryId,
                ParentCategoryId,
                Name,
                Slug,
                Description,
                SortOrder,
                IsActive
            FROM dbo.Categories
            WHERE CategoryId = @Id
        `;
    },

    CHECK_CATEGORY_SLUG_TAKEN: () => {
        return `
            SELECT 1 AS Taken
            FROM dbo.Categories
            WHERE Slug = @Slug
              AND (@Id IS NULL OR CategoryId <> @Id)
        `;
    },

    CHECK_CATEGORY_HAS_CHILDREN: () => {
        return `
            SELECT TOP 1 1 AS Yes
            FROM dbo.Categories
            WHERE ParentCategoryId = @Id
        `;
    },

    // New categories go to the end of their level (sort order = highest + 10).
    INSERT_CATEGORY: () => {
        return `
            INSERT INTO dbo.Categories (
                ParentCategoryId,
                Name,
                Slug,
                Description,
                SortOrder
            )
            OUTPUT inserted.CategoryId
            VALUES (
                @ParentCategoryId,
                @Name,
                @Slug,
                @Description,
                (SELECT ISNULL(MAX(SortOrder), 0) + 10 FROM dbo.Categories WHERE ${SAME_PARENT})
            )
        `;
    },

    UPDATE_CATEGORY: () => {
        return `
            UPDATE dbo.Categories
            SET ParentCategoryId = @ParentCategoryId,
                Name = @Name,
                Slug = @Slug,
                Description = @Description,
                IsActive = @IsActive
            WHERE CategoryId = @Id
        `;
    },

    GET_SIBLING_CATEGORIES: () => {
        return `
            SELECT
                CategoryId,
                SortOrder
            FROM dbo.Categories
            WHERE ${SAME_PARENT}
            ORDER BY SortOrder, Name
        `;
    },

    UPDATE_CATEGORY_SORT_ORDER: () => {
        return `
            UPDATE dbo.Categories
            SET SortOrder = @SortOrder
            WHERE CategoryId = @Id
        `;
    },

    GET_PRODUCT_COUNTS: () => {
        return `
            SELECT
                CategoryId,
                COUNT(*) AS Products
            FROM dbo.Products
            GROUP BY CategoryId
        `;
    },

    /* ---------------- products ---------------- */

    // Up to 500 products, recently changed first. Filters are optional: NULL means "any".
    GET_PRODUCTS: () => {
        return `
            SELECT ${PRODUCT_COLUMNS},
                c.Name AS CategoryName,
                (SELECT TOP 1 StorageKey FROM dbo.ProductImages i WHERE i.ProductId = p.ProductId ORDER BY i.IsPrimary DESC, i.SortOrder) AS ImageKey
            FROM dbo.Products p
            JOIN dbo.Categories c ON c.CategoryId = p.CategoryId
            WHERE (@Q IS NULL OR p.Title LIKE @Q OR p.Author LIKE @Q OR p.Publisher LIKE @Q OR p.Isbn LIKE @Q OR p.Sku LIKE @Q)
              AND (@CategoryId IS NULL OR p.CategoryId = @CategoryId OR c.ParentCategoryId = @CategoryId)
              AND (@Type IS NULL OR p.ProductType = @Type)
              AND (@Stock IS NULL OR (@Stock = 'low' AND p.StockQty > 0 AND p.StockQty <= p.LowStockAt) OR (@Stock = 'out' AND p.StockQty = 0))
              AND (@Status IS NULL OR (@Status = 'active' AND p.IsActive = 1) OR (@Status = 'hidden' AND p.IsActive = 0))
            ORDER BY p.UpdatedOn DESC
            OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY
        `;
    },

    GET_PRODUCT_BY_ID: () => {
        return `
            SELECT ${PRODUCT_COLUMNS}
            FROM dbo.Products p
            WHERE p.ProductId = @Id
        `;
    },

    GET_PRODUCT_IMAGES: () => {
        return `
            SELECT
                ProductImageId,
                StorageKey
            FROM dbo.ProductImages
            WHERE ProductId = @Id
            ORDER BY IsPrimary DESC, SortOrder
        `;
    },

    // Whether another product already uses this slug, ISBN or SKU.
    CHECK_PRODUCT_TAKEN: () => {
        return `
            SELECT
                (SELECT COUNT(*) FROM dbo.Products WHERE Slug = @Slug AND (@Id IS NULL OR ProductId <> @Id)) AS SlugTaken,
                (SELECT COUNT(*) FROM dbo.Products WHERE @Isbn IS NOT NULL AND Isbn = @Isbn AND (@Id IS NULL OR ProductId <> @Id)) AS IsbnTaken,
                (SELECT COUNT(*) FROM dbo.Products WHERE @Sku IS NOT NULL AND Sku = @Sku AND (@Id IS NULL OR ProductId <> @Id)) AS SkuTaken
        `;
    },

    CHECK_PRODUCT_EXISTS: () => {
        return `
            SELECT
                ProductId
            FROM dbo.Products
            WHERE ProductId = @Id
        `;
    },

    // New products start with 0 stock; opening stock is added through the stock ledger.
    INSERT_PRODUCT: () => {
        return `
            INSERT INTO dbo.Products (
                ProductId,
                Sku,
                ProductType,
                CategoryId,
                Title,
                Slug,
                Author,
                Publisher,
                Isbn,
                Edition,
                PublishYear,
                Language,
                ClassLevel,
                Board,
                Subject,
                Description,
                Mrp,
                PricingMode,
                DiscountPercent,
                NetPrice,
                GstPercent,
                HsnCode,
                StockQty,
                LowStockAt,
                WeightGrams,
                IsFeatured,
                IsActive
            ) VALUES (
                @NewId,
                @Sku,
                @ProductType,
                @CategoryId,
                @Title,
                @Slug,
                @Author,
                @Publisher,
                @Isbn,
                @Edition,
                @PublishYear,
                @Language,
                @ClassLevel,
                @Board,
                @Subject,
                @Description,
                @Mrp,
                @PricingMode,
                @DiscountPercent,
                @NetPrice,
                @GstPercent,
                @HsnCode,
                0,
                @LowStockAt,
                @WeightGrams,
                @IsFeatured,
                @IsActive
            )
        `;
    },

    UPDATE_PRODUCT: () => {
        return `
            UPDATE dbo.Products
            SET Sku = @Sku,
                ProductType = @ProductType,
                CategoryId = @CategoryId,
                Title = @Title,
                Slug = @Slug,
                Author = @Author,
                Publisher = @Publisher,
                Isbn = @Isbn,
                Edition = @Edition,
                PublishYear = @PublishYear,
                Language = @Language,
                ClassLevel = @ClassLevel,
                Board = @Board,
                Subject = @Subject,
                Description = @Description,
                Mrp = @Mrp,
                PricingMode = @PricingMode,
                DiscountPercent = @DiscountPercent,
                NetPrice = @NetPrice,
                GstPercent = @GstPercent,
                HsnCode = @HsnCode,
                LowStockAt = @LowStockAt,
                WeightGrams = @WeightGrams,
                IsFeatured = @IsFeatured,
                IsActive = @IsActive,
                UpdatedOn = SYSUTCDATETIME()
            WHERE ProductId = @Id
        `;
    },

    UPDATE_PRODUCT_ACTIVE: () => {
        return `
            UPDATE dbo.Products
            SET IsActive = @Active,
                UpdatedOn = SYSUTCDATETIME()
            WHERE ProductId = @Id
        `;
    },

    DELETE_PRODUCT_IMAGES: () => {
        return `
            DELETE FROM dbo.ProductImages
            WHERE ProductId = @Id
        `;
    },

    INSERT_PRODUCT_IMAGE: () => {
        return `
            INSERT INTO dbo.ProductImages (
                ProductId,
                StorageKey,
                SortOrder,
                IsPrimary
            ) VALUES (
                @ProductId,
                @StorageKey,
                @SortOrder,
                @IsPrimary
            )
        `;
    },

    // When a product is created from a customer's book request, remember which request line it came from.
    LINK_REQUEST_ITEM_TO_PRODUCT: () => {
        return `
            UPDATE dbo.ProductRequestItems
            SET LinkedProductId = @ProductId
            WHERE RequestId = @RequestId
              AND LineNumber = @LineNumber
        `;
    },

    /* ---------------- stock ---------------- */

    GET_STOCK_LEDGER: () => {
        return `
            SELECT TOP 200
                EntryId,
                ProductId,
                Change,
                QtyAfter,
                Reason,
                RefId,
                Note,
                CreatedOn
            FROM dbo.StockLedger
            WHERE ProductId = @Id
            ORDER BY EntryId DESC
        `;
    },
};
