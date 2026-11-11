// Rules for serving files: product photos (public) and request attachments (signed-in owner only;
// utils/auth.js lets only /files/products/... through without a sign-in).
// No database here, so this module has no sql.js or DA file.
const { fail } = require('../../utils/access');
const { sendFile } = require('../../utils/fileStore');

const ALLOWED_FILE = /^(products|requests)\/[\w-]+\/[\w-]+\.(jpg|png|webp|pdf)$/;

// Streams the file to the response; anything outside the allowed folders is "not found".
exports.getFile = async (res, key) => {
    try {
        if (!ALLOWED_FILE.test(key)) throw fail(404, 'File not found.');
        await sendFile(res, key);
    } catch (err) {
        if (!err.status) console.log('error in fileService.getFile', err);
        throw err;
    }
};
