// Business rules for categories, products, photos and stock: validation (same rules as the database
// CHECK constraints), unique slug/ISBN/SKU, two-level categories, photo uploads and stock movements.
// No SQL and no req/res here: the database goes through catalogueDA.js, the HTTP side is catalogueHandler.js.
// Each exported function: try → do the work → return the result; catch → log unexpected errors → throw to the handler.
const crypto = require('crypto');

const { fail, needGuid, isGuid, text, money } = require('../../utils/access');
const { audit, moveStock } = require('../../utils/shop');
const fileStore = require('../../utils/fileStore');
const catalogueDA = require('./catalogueDA');

const TYPES = ['BOOK', 'STATIONERY', 'NOTEBOOK', 'KIT'];
const GST_RATES = [0, 5, 12, 18, 28];
const STOCK_REASONS = ['RESTOCK', 'DAMAGE', 'CORRECTION'];
const CATEGORY_NAME_MAX = 30; // shown in the website menu and header bar
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const PRODUCT_PHOTO_KEY = /^products\/[\w-]+\/[\w-]+\.(jpg|png|webp)$/;

/* ---------------- helpers ---------------- */

// "Class 10 Maths (2026)" → "class-10-maths-2026"
const slugify = (s) =>
    String(s || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 120);

const likePattern = (q) => {
    const t = text(q, 100);
    return t ? `%${t.replace(/[%_[]/g, '[$&]')}%` : null;
};

// Creates or updates a category. Categories are at most two levels deep.
const saveCategory = async (adminId, body, categoryId) => {
    const name = text(body.Name, 200);
    if (!name) throw fail(400, 'Enter a category name.');
    if (name.length > CATEGORY_NAME_MAX) throw fail(400, `Keep the category name to ${CATEGORY_NAME_MAX} characters so it fits the website menu.`);
    const id = categoryId ? needGuid(categoryId, 'category') : null;
    const parentId = body.ParentCategoryId ? needGuid(body.ParentCategoryId, 'parent category') : null;
    const slug = slugify(body.Slug || name);
    if (!slug) throw fail(400, 'Use letters or numbers in the name.');

    if (await catalogueDA.checkCategorySlugTaken(slug, id)) throw fail(409, 'Another category already uses this name/link.');
    if (parentId) {
        const parent = await catalogueDA.getCategoryById(parentId);
        if (!parent) throw fail(400, 'That parent category was not found.');
        if (parent.ParentCategoryId) throw fail(400, 'Categories can only be two levels deep.');
        if (id && parentId === id) throw fail(400, "A category can't be inside itself.");
        if (id && (await catalogueDA.checkCategoryHasChildren(id))) throw fail(400, 'This category has sub-categories, so it must stay at the top level.');
    }

    const category = { parentId, name, slug, description: text(body.Description, 400), isActive: body.IsActive !== false };
    let savedId = id;
    if (id) {
        if (!(await catalogueDA.getCategoryById(id))) throw fail(404, 'That category was not found.');
        await catalogueDA.updateCategory(id, category);
    } else {
        savedId = await catalogueDA.insertCategory(category);
    }
    await audit({ actorId: adminId, action: id ? 'CATEGORY_UPDATED' : 'CATEGORY_CREATED', entityType: 'Category', entityId: savedId, details: { name } });
    return catalogueDA.getCategoryById(savedId);
};

// Field-level messages for the product editor (same rules as the CHECK constraints on dbo.Products).
const validateProduct = (p, isNew) => {
    const e = {};
    if (!text(p.Title, 250)) e.Title = 'Enter the title.';
    if (!TYPES.includes(p.ProductType)) e.ProductType = 'Choose a type.';
    if (!isGuid(p.CategoryId)) e.CategoryId = 'Choose a category.';
    const mrp = Number(p.Mrp);
    if (!(mrp > 0)) e.Mrp = 'MRP must be more than 0.';
    if (p.PricingMode === 'DISCOUNT') {
        const d = p.DiscountPercent === '' || p.DiscountPercent == null ? 0 : Number(p.DiscountPercent);
        if (!(d >= 0 && d <= 90)) e.DiscountPercent = 'Discount must be between 0 and 90%.';
    } else if (p.PricingMode === 'NET') {
        const n = Number(p.NetPrice);
        if (!(n > 0)) e.NetPrice = 'Enter the net price.';
        else if (mrp > 0 && n > mrp) e.NetPrice = "Net price can't be more than the MRP.";
    } else e.PricingMode = 'Choose Discount or Net price.';
    if (!GST_RATES.includes(Number(p.GstPercent))) e.GstPercent = 'Choose a GST rate.';
    if (p.HsnCode && !/^\d{4,8}$/.test(p.HsnCode)) e.HsnCode = 'HSN is 4 to 8 digits.';
    if (p.Isbn && !/^(\d{9}[\dX]|\d{13})$/.test(p.Isbn)) e.Isbn = 'ISBN is 10 or 13 characters (digits, ISBN-10 may end in X).';
    if (p.PublishYear && !(Number(p.PublishYear) >= 1900 && Number(p.PublishYear) <= 2100)) e.PublishYear = 'Check the year.';
    if (!(Number(p.LowStockAt) >= 0)) e.LowStockAt = '0 or more.';
    if (isNew && !(Number(p.StockQty || 0) >= 0)) e.StockQty = '0 or more.';
    if (p.WeightGrams && !(Number(p.WeightGrams) > 0)) e.WeightGrams = 'Check the weight.';
    return e;
};

// Clean column values by their @parameter names (see sql.INSERT_PRODUCT / UPDATE_PRODUCT).
const productValues = (body) => ({
    Sku: text(body.Sku, 40),
    ProductType: body.ProductType,
    CategoryId: body.CategoryId,
    Title: text(body.Title, 250),
    Slug: slugify(body.Slug || body.Title),
    Author: text(body.Author, 200),
    Publisher: text(body.Publisher, 150),
    Isbn: text(body.Isbn, 13),
    Edition: text(body.Edition, 60),
    PublishYear: body.PublishYear ? Number(body.PublishYear) : null,
    Language: text(body.Language, 40),
    ClassLevel: text(body.ClassLevel, 40),
    Board: text(body.Board, 40),
    Subject: text(body.Subject, 80),
    Description: text(body.Description, 8000),
    Mrp: money(body.Mrp),
    PricingMode: body.PricingMode,
    DiscountPercent: body.PricingMode === 'DISCOUNT' ? Number(body.DiscountPercent) || 0 : null,
    NetPrice: body.PricingMode === 'NET' ? money(body.NetPrice) : null,
    GstPercent: Number(body.GstPercent),
    HsnCode: text(body.HsnCode, 8),
    LowStockAt: Number(body.LowStockAt),
    WeightGrams: body.WeightGrams ? Number(body.WeightGrams) : null,
    IsFeatured: Boolean(body.IsFeatured),
    IsActive: body.IsActive !== false,
});

// Stores new photos (data URLs) and keeps existing ones. Returns the final ordered keys and the newly uploaded ones.
const storePhotos = async (images, productId) => {
    const uploaded = [];
    const keys = [];
    try {
        for (const img of (Array.isArray(images) ? images : []).slice(0, MAX_IMAGES)) {
            if (typeof img === 'string' && img.startsWith('data:')) {
                const file = fileStore.fromDataUrl(img, { allow: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: MAX_IMAGE_BYTES });
                if (!file) throw fail(400, 'One of the photos is not a JPG, PNG or WebP under 3 MB.');
                const key = fileStore.newKey(`products/${productId}`, file.type.ext);
                await fileStore.put(key, file.buffer);
                uploaded.push(key);
                keys.push(key);
            } else if (typeof img === 'string' && PRODUCT_PHOTO_KEY.test(img)) {
                keys.push(img);
            }
        }
        return { keys, uploaded };
    } catch (err) {
        await Promise.all(uploaded.map((k) => fileStore.remove(k).catch(() => null)));
        throw err;
    }
};

/**
 * Creates (productId = null) or updates a product. body.Images is the final ordered list (first = main photo);
 * each entry is either an existing storage key or a new "data:image/...;base64," upload.
 */
const saveProduct = async (adminId, body, productId) => {
    const id = productId ? needGuid(productId, 'product') : null;
    const newId = id ? null : crypto.randomUUID();
    const errors = validateProduct(body, !id);
    if (Object.keys(errors).length) throw fail(400, 'Please fix the highlighted fields.', { errors });

    const values = productValues(body);
    const taken = await catalogueDA.checkProductTaken({ productId: id, slug: values.Slug, isbn: values.Isbn, sku: values.Sku });
    if (taken.SlugTaken) throw fail(409, 'Another product already has this title/link. Change the web link slightly.', { errors: { Slug: 'Already used' } });
    if (taken.IsbnTaken) throw fail(409, 'Another product already has this ISBN.', { errors: { Isbn: 'Already used' } });
    if (taken.SkuTaken) throw fail(409, 'Another product already has this SKU.', { errors: { Sku: 'Already used' } });

    // Upload new photos first (outside the transaction); remove them again if saving fails.
    const { keys, uploaded } = await storePhotos(body.Images, id || newId);
    const savedId = id || newId;
    try {
        await catalogueDA.withTransaction(async (tx) => {
            if (id) {
                if (!(await catalogueDA.checkProductExists(tx, id))) throw fail(404, 'That product was not found.');
                await catalogueDA.updateProduct(tx, id, values);
            } else {
                await catalogueDA.insertProduct(tx, newId, values);
                const opening = Math.trunc(Number(body.StockQty) || 0);
                if (opening > 0) await moveStock(tx, { productId: newId, change: opening, reason: 'RESTOCK', note: 'Opening stock', adminId });
                const from = body.fromRequest;
                if (from && isGuid(from.requestId) && Number(from.line) > 0) await catalogueDA.linkRequestItemToProduct(tx, newId, from.requestId, Number(from.line));
            }
            await catalogueDA.deleteProductImages(tx, savedId);
            for (let i = 0; i < keys.length; i += 1) await catalogueDA.insertProductImage(tx, savedId, keys[i], i);
        });
    } catch (err) {
        await Promise.all(uploaded.map((k) => fileStore.remove(k).catch(() => null)));
        throw err;
    }
    await audit({ actorId: adminId, action: id ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED', entityType: 'Product', entityId: savedId, details: { title: values.Title } });
    return exports.getProductById(savedId);
};

/* ---------------- categories (called by catalogueHandler.js) ---------------- */

// All categories with how many products each has.
exports.getCategories = async () => {
    try {
        const [cats, counts] = await Promise.all([catalogueDA.getCategories(), catalogueDA.getProductCounts()]);
        const byCat = Object.fromEntries(counts.map((c) => [c.CategoryId, c.Products]));
        const result = cats.map((c) => ({ ...c, ProductCount: byCat[c.CategoryId] || 0 }));
        return result;
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.getCategories', err);
        throw err;
    }
};

exports.createCategory = async (adminId, categoryData) => {
    try {
        const result = await saveCategory(adminId, categoryData, null);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.createCategory', err);
        throw err;
    }
};

exports.updateCategory = async (adminId, categoryId, categoryData) => {
    try {
        const result = await saveCategory(adminId, categoryData, categoryId);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.updateCategory', err);
        throw err;
    }
};

// Swaps with the neighbour above (dir < 0) or below (dir > 0), then renumbers 10, 20, 30...
exports.moveCategory = async (categoryId, dir) => {
    try {
        const id = needGuid(categoryId, 'category');
        const cat = await catalogueDA.getCategoryById(id);
        if (!cat) throw fail(404, 'That category was not found.');
        await catalogueDA.withTransaction(async (tx) => {
            const siblings = await catalogueDA.getSiblingCategories(tx, cat.ParentCategoryId);
            const order = siblings.map((s) => s.CategoryId.toLowerCase());
            const i = order.indexOf(id);
            const j = i + (Number(dir) < 0 ? -1 : 1);
            if (i < 0 || j < 0 || j >= order.length) return;
            [order[i], order[j]] = [order[j], order[i]];
            for (let n = 0; n < order.length; n += 1) await catalogueDA.updateCategorySortOrder(tx, order[n], (n + 1) * 10);
        });
        return { ok: true };
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.moveCategory', err);
        throw err;
    }
};

/* ---------------- products ---------------- */

// Product list with optional filters: q, categoryId, type, stock (low|out), status (active|hidden).
exports.getProducts = async (query) => {
    try {
        const q = query || {};
        const rows = await catalogueDA.getProducts({
            q: likePattern(q.q),
            categoryId: isGuid(q.categoryId) ? q.categoryId : null,
            type: TYPES.includes(q.type) ? q.type : null,
            stock: ['low', 'out'].includes(q.stock) ? q.stock : null,
            status: ['active', 'hidden'].includes(q.status) ? q.status : null,
        });
        const result = rows.map(({ ImageKey, ...p }) => ({ ...p, Images: ImageKey ? [ImageKey] : [] }));
        return result;
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.getProducts', err);
        throw err;
    }
};

// One product with all its photos (main photo first).
exports.getProductById = async (productId) => {
    try {
        const id = needGuid(productId, 'product');
        const p = await catalogueDA.getProductById(id);
        if (!p) throw fail(404, 'That product was not found.');
        const images = await catalogueDA.getProductImages(id);
        const result = { ...p, Images: images.map((i) => i.StorageKey) };
        return result;
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.getProductById', err);
        throw err;
    }
};

exports.createProduct = async (adminId, productData) => {
    try {
        const result = await saveProduct(adminId, productData, null);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.createProduct', err);
        throw err;
    }
};

exports.updateProduct = async (adminId, productId, productData) => {
    try {
        const result = await saveProduct(adminId, productData, productId);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.updateProduct', err);
        throw err;
    }
};

// Shows (active = true) or hides a product on the shop website.
exports.setProductActive = async (adminId, productId, active) => {
    try {
        const id = needGuid(productId, 'product');
        await catalogueDA.updateProductActive(id, Boolean(active));
        await audit({ actorId: adminId, action: active ? 'PRODUCT_SHOWN' : 'PRODUCT_HIDDEN', entityType: 'Product', entityId: id });
        const result = await exports.getProductById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.setProductActive', err);
        throw err;
    }
};

/* ---------------- stock ---------------- */

// Adds (+) or removes (−) stock with a reason; every change goes into the stock ledger.
exports.adjustStock = async (adminId, productId, change, reason, note) => {
    try {
        const id = needGuid(productId, 'product');
        const n = Math.trunc(Number(change));
        if (!n) throw fail(400, 'Enter how many to add (+) or remove (−).');
        if (!STOCK_REASONS.includes(reason)) throw fail(400, 'Choose a reason.');
        if (reason === 'RESTOCK' && n < 0) throw fail(400, 'Restock adds stock. Use Damage or Correction to remove.');
        if (reason === 'DAMAGE' && n > 0) throw fail(400, 'Damage removes stock. Enter a negative number.');
        await catalogueDA.withTransaction((tx) => moveStock(tx, { productId: id, change: n, reason, note: text(note, 300), adminId }));
        await audit({ actorId: adminId, action: 'STOCK_ADJUSTED', entityType: 'Product', entityId: id, details: { change: n, reason } });
        const result = await exports.getProductById(id);
        return result;
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.adjustStock', err);
        throw err;
    }
};

// The last 200 stock movements of a product.
exports.getStockLedger = async (productId) => {
    try {
        const result = await catalogueDA.getStockLedger(needGuid(productId, 'product'));
        return result;
    } catch (err) {
        if (!err.status) console.log('error in catalogueService.getStockLedger', err);
        throw err;
    }
};
