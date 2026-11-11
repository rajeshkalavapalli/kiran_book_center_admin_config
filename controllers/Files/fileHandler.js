// HTTP side of file serving. Streams the file itself instead of sending JSON.
const fileService = require('./fileService');

exports.getFile = async (req, res) => {
    try {
        // Express 5 wildcard: /files/*path gives the rest of the path as an array of segments.
        const key = [].concat(req.params.path).join('/');
        await fileService.getFile(res, key);
    } catch (err) {
        if (!err.status) console.log('error while sending the file', err);
        if (!res.headersSent) res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to load the file.' });
    }
};
