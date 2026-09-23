const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const COOKIE = 'nitewide_demo_access';
const TTL = 12 * 60 * 60;
const digest = value => crypto.createHash('sha256').update(value).digest();
const same = (left, right) => crypto.timingSafeEqual(digest(left), digest(right));
const safeNext = value => typeof value === 'string' && /^\/(?!\/)/.test(value) && !/[\\\r\n]/.test(value) ? value : '/';

function createDemoGate({ password, secret, secure = true, now = Date.now }) {
  if (!password || password.length < 16 || !secret || secret.length < 32) throw new Error('Hosted demo requires strong access and signing secrets');
  const sign = value => crypto.createHmac('sha256', secret).update(`${value}:${password}`).digest('base64url');
  const failures = new Map();
  const router = express.Router();
  router.use((_req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow, noarchive'); res.set('Cache-Control', 'no-store'); next(); });
  router.get('/demo-access', (_req, res) => res.sendFile(path.join(__dirname, 'demo-access.html')));
  router.post('/demo-access', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    if (req.get('origin') && req.get('origin') !== `${req.protocol}://${req.get('host')}`) return res.sendStatus(403);
    const key = req.ip;
    const attempt = failures.get(key);
    if (attempt && attempt.until > now() && attempt.count >= 10) return res.status(429).send('Too many attempts. Try again in 15 minutes.');
    if (!same(String(req.body.password || ''), password)) {
      if (failures.size > 10000) failures.clear();
      failures.set(key, { count: attempt?.until > now() ? attempt.count + 1 : 1, until: now() + 900000 });
      return res.redirect(303, '/demo-access?error=1');
    }
    failures.delete(key);
    const expires = String(Math.floor(now() / 1000) + TTL);
    res.cookie(COOKIE, `${expires}.${sign(expires)}`, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: TTL * 1000 });
    return res.redirect(303, safeNext(req.body.next));
  });
  router.use((req, res, next) => {
    const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
    const [expires, signature, extra] = cookie.split('.');
    if (!extra && /^\d+$/.test(expires || '') && Number(expires) > now() / 1000 && signature && same(signature, sign(expires))) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') && req.get('origin') !== `${req.protocol}://${req.get('host')}`) return res.sendStatus(403);
      return next();
    }
    if (req.path.startsWith('/api')) return res.status(401).json({ error: { code: 'DEMO_ACCESS_REQUIRED', message: 'Open the demo website and enter the shared access password first.' } });
    return res.redirect(302, '/demo-access');
  });
  return router;
}
module.exports = { createDemoGate, safeNext };
