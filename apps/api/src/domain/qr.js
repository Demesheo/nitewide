const crypto = require('node:crypto');
function createQrToken() { const token = crypto.randomBytes(32).toString('base64url'); return { token, hash: hashQrToken(token) }; }
function hashQrToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
module.exports = { createQrToken, hashQrToken };

