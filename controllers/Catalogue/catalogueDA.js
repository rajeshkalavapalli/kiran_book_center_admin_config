// Data access for categories, products and stock history: runs the queries in sql.js and returns plain rows.
// Functions that take `tx` run inside the caller's transaction.
const { customQuery, inTransaction } = require('../../utils/dbFunctions');
const sql = require('./sql');

const run = (tx) => (tx ? tx.run : customQuery);

exports.withTransaction = inTransaction;

/* ---------------- categories ---------------- */

exports.getCategories = async () => {
    return await customQuery(sql.GET_CATEGORIES());
};

exports.getCategoryById = async (categoryId) => {
    const [row] = await customQuery(sql.GET_CATEGORY_BY_ID(), { Id: categoryId });
    return row || null;
};

exports.checkCategorySlugTaken = async (slug, categoryId) => {
    const rows = await customQuery(sql.CHECK_CATEGORY_SLUG_TAKEN(), { Slug: slug, Id: categoryId });
    return rows.length > 0;
};

exports.checkCategoryHasChildren = async (categoryId) => {
    const rows = await customQuery(sql.CHECK_CATEGORY_HAS_CHILDREN(), { Id: categoryId });
    return rows.length > 0;
};

exports.insertCategory = async (c) => {
    const [row] = await customQuery(sql.INSERT_CATEGORY(), { ParentCategoryId: c.parentId, Name: c.name, Slug: c.slug, Description: c.description });
    return row.CategoryId;
};

exports.updateCategory = async (categoryId, c) => {
    return await customQuery(sql.UPDATE_CATEGORY(), { Id: categoryId, ParentCategoryId: c.parentId, Name: c.name, Slug: c.slug, Description: c.description, IsActive: c.isActive });
};

exports.getSiblingCategories = async (tx, parentId) => {
    return await run(tx)(sql.GET_SIBLING_CATEGORIES(), { ParentCategoryId: parentId });
};

exports.updateCategorySortOrder = async (tx, categoryId, sortOrder) => {
    return await run(tx)(sql.UPDATE_CATEGORY_SORT_ORDER(), { Id: categoryId, SortOrder: sortOrder });
};

exports.getProductCounts = async () => {
    return await customQuery(sql.GET_PRODUCT_COUNTS());
};

/* ---------------- products ---------------- */

exports.getProducts = async (filters) => {
    return await customQuery(sql.GET_PRODUCTS(), { Q: filters.q, CategoryId: filters.categoryId, Type: filters.type, Stock: filters.stock, Status: filters.status });
};

exports.getProductById = async (productId) => {
    const [row] = await customQuery(sql.GET_PRODUCT_BY_ID(), { Id: productId });
    return row || null;
};

exports.getProductImages = async (productId) => {
    return await customQuery(sql.GET_PRODUCT_IMAGES(), { Id: productId });
};

exports.checkProductTaken = async ({ productId, slug, isbn, sku }) => {
    const [row] = await customQuery(sql.CHECK_PRODUCT_TAKEN(), { Id: productId, Slug: slug, Isbn: isbn, Sku: sku });
    return row;
};

exports.checkProductExists = async (tx, productId) => {
    const rows = await run(tx)(sql.CHECK_PRODUCT_EXISTS(), { Id: productId });
    return rows.length > 0;
};

// `values` holds the product columns by their @parameter names (see sql.INSERT_PRODUCT).
exports.insertProduct = async (tx, newId, values) => {
    return await run(tx)(sql.INSERT_PRODUCT(), { ...values, NewId: newId });
};

exports.updateProduct = async (tx, productId, values) => {
    return await run(tx)(sql.UPDATE_PRODUCT(), { ...values, Id: productId });
};

exports.updateProductActive = async (productId, active) => {
    return await customQuery(sql.UPDATE_PRODUCT_ACTIVE(), { Id: productId, Active: active });
};

exports.deleteProductImages = async (tx, productId) => {
    return await run(tx)(sql.DELETE_PRODUCT_IMAGES(), { Id: productId });
};

exports.insertProductImage = async (tx, productId, storageKey, sortOrder) => {
    return await run(tx)(sql.INSERT_PRODUCT_IMAGE(), { ProductId: productId, StorageKey: storageKey, SortOrder: sortOrder, IsPrimary: sortOrder === 0 });
};

exports.linkRequestItemToProduct = async (tx, productId, requestId, lineNumber) => {
    return await run(tx)(sql.LINK_REQUEST_ITEM_TO_PRODUCT(), { ProductId: productId, RequestId: requestId, LineNumber: lineNumber });
};

/* ---------------- stock ---------------- */

exports.getStockLedger = async (productId) => {
    return await customQuery(sql.GET_STOCK_LEDGER(), { Id: productId });
};
