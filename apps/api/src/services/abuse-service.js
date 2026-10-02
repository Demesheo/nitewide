const crypto = require('node:crypto');
const ipaddr = require('ipaddr.js');
const { DomainError } = require('../domain/errors');

// Fixed windows start at first use; counters are shared by every API instance.
const POLICIES = {
  login: { seconds: 900, ip: 60, account: 30, pair: 10 },
  registration: { seconds: 3600, ip: 20, account: 5 },
  access_request: { seconds: 86400, ip: 20, account: 3 },
  recovery: { seconds: 3600, ip: 30, account: 5, user: 5 },
  password_change: { seconds: 3600, ip: 30, user: 5 },
  invitation: { seconds: 3600, ip: 300, user: 100 },
  guestlist_link: { seconds: 60, ip: 120 },
  upload: { seconds: 3600, ip: 120, user: 40 },
  report: { seconds: 60, ip: 300, user: 120 },
  export: { seconds: 60, ip: 30, user: 10 },
  session: { seconds: 60, ip: 120, user: 30 },
  message: { seconds: 60, ip: 120, user: 30 },
  commission_payment: { seconds: 60, ip: 90, user: 30 },
};
function clientNetwork(value) {
  try {
    const address = ipaddr.process(value);
    if (address.kind() === 'ipv4') return address.toString();
    // IPv6 privacy address rotation must not bypass limits.
    return `${address.parts.slice(0, 4).map((part) => part.toString(16)).join(':')}::/64`;
  } catch { return 'unknown'; }
}
function routePolicy(method, path) {
  if (method === 'HEAD') method = 'GET'; // Express executes GET handlers for HEAD.
  path = path.toLowerCase().replace(/\/+$/, '');
  if (method === 'POST' && ['/auth/sign-in','/auth/business/sign-in'].includes(path)) return 'login';
  if (method === 'POST' && path === '/business/access-requests') return 'access_request';
  if (method === 'POST' && path === '/auth/register') return 'registration';
  if (method === 'POST' && path === '/auth/password/change') return 'password_change';
  if (['GET','POST'].includes(method) && /^\/guestlist-invitations\/[^/]+\/(claim|pass)$/.test(path)) return 'guestlist_link';
  if (method === 'POST' && /^\/auth\/(password-reset|email|onboarding)/.test(path)) return 'recovery';
  if (/^\/auth\/sessions/.test(path) || path === '/auth/logout') return 'session';
  if (['POST','PATCH'].includes(method) && (/^\/(customer|business)\/(?:messages(?:\/|$)|orders\/[^/]+\/(messages|refund-request)$)/.test(path))) return 'message';
  if (method === 'POST' && (/^\/account\/commission-payment-profile(?:\/|$)/.test(path) || /\/commission-(payments|statements)(?:\/|$)/.test(path))) return 'commission_payment';
  if (method === 'POST' && /\/(invitations|guestlist-invitations|guestlist_invitations|team_invitations|onboarding|instructions)(\/|$)/.test(path)) return 'invitation';
  if (method === 'POST' && /\/uploads\//.test(path)) return 'upload';
  if (method === 'GET' && /(?:export|\.csv)(?:\/|$)/.test(path)) return 'export';
  if (method === 'POST' && /^\/business\/reports\/exports\/[^/]+\/retry$/.test(path)) return 'export';
  if (method === 'GET' && /^\/customer\/my-events(?:\/[^/]+(?:\/guestlist-page(?:\/[^/]+)?)?)?$/.test(path) && path !== '/customer/my-events/access') return 'report';
  if (method === 'GET' && /^\/(business|admin)\//.test(path) && /\/(analytics|reports|overview|workspace|operations)(\/|$)/.test(path)) return 'report';
  return null;
}
function createAbuseService({ sequelize, secret, policies = POLICIES, clock = Date.now }) {
  const digest = (value) => crypto.createHmac('sha256', secret).update(value).digest('hex');
  let nextPrune = clock() + 60000;
  async function prune() {
    if (clock() < nextPrune) return;
    nextPrune = clock() + 60000;
    // Bounded, indexed cleanup; no timers and no unbounded deletion transaction.
    // Recheck expiry on the locked target row: an upsert may have renewed it
    // after the subquery selected it but before DELETE acquires its row lock.
    await sequelize.query(`DELETE FROM abuse_buckets WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day' AND key IN (SELECT key FROM abuse_buckets WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day' LIMIT 1000)`);
    await sequelize.query(`DELETE FROM auth_sessions WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day' AND id IN (SELECT id FROM auth_sessions WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day' LIMIT 1000)`);
  }
  async function consume(group, dimension, identity) {
    const policy = policies[group];
    const key = `${group}:${dimension}:${digest(identity)}`;
    try {
      const [rows] = await sequelize.query(`INSERT INTO abuse_buckets (key, count, expires_at)
        VALUES (:key, 1, CURRENT_TIMESTAMP + :seconds * INTERVAL '1 second')
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN abuse_buckets.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE LEAST(abuse_buckets.count + 1, :limit + 1) END,
          expires_at = CASE WHEN abuse_buckets.expires_at <= CURRENT_TIMESTAMP THEN EXCLUDED.expires_at ELSE abuse_buckets.expires_at END
        RETURNING count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - CURRENT_TIMESTAMP))) AS retry`,
      { replacements: { key, seconds: policy.seconds, limit: policy[dimension] } });
      if (rows[0].count > policy[dimension]) {
        throw new DomainError('Too many requests. Please try again shortly.', {
          code: 'RATE_LIMITED', status: 429, details: { retryAfterSeconds: Number(rows[0].retry) },
        });
      }
    } catch (error) {
      if (error.code === 'RATE_LIMITED') throw error;
      // A failed shared store must not turn protection off.
      throw new DomainError('Security controls are temporarily unavailable. Please try again.', { code: 'SECURITY_UNAVAILABLE', status: 503 });
    }
  }
  return {
    async before(req) {
      const group = routePolicy(req.method, req.path);
      if (!group) return;
      req.abuseGroup = group;
      const network = clientNetwork(req.ip);
      await consume(group, 'ip', network);
      await prune();
      if (policies[group].account && typeof req.body?.email === 'string') {
        const account = req.body.email.trim().toLowerCase().slice(0, 320);
        await consume(group, 'account', account);
        if (policies[group].pair) await consume(group, 'pair', `${network}|${account}`);
      }
    },
    async authenticated(req) {
      if (req.abuseActorCharged || !policies[req.abuseGroup]?.user) return;
      req.abuseActorCharged = true;
      await consume(req.abuseGroup, 'user', req.userId);
    },
  };
}
module.exports = { createAbuseService, POLICIES, clientNetwork, routePolicy };
