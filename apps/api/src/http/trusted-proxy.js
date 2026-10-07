const ipaddr = require('ipaddr.js');

// Reviewed 2026-10-06 against https://www.cloudflare.com/ips/ (IPv4 + IPv6).
// Keep this finite list reviewed with infrastructure changes; never fetch a
// trust policy from the network during startup or a request.
const CLOUDFLARE_CIDRS = Object.freeze([
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32',
  '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
]);
const cloudflare = CLOUDFLARE_CIDRS.map(cidr => ipaddr.parseCIDR(cidr));
const privatePeer = ['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7']
  .map(cidr => ipaddr.parseCIDR(cidr));
const matches = (address, ranges) => ranges.some(([network, prefix]) => address.kind() === network.kind() && address.match(network, prefix));

function cloudflareRenderProxy(ip, index) {
  try {
    const address = ipaddr.process(ip);
    // Render's private/loopback ingress is trusted only as the socket peer,
    // never merely because a caller placed a private address in X-Forwarded-For.
    if (index === 0 && matches(address, privatePeer)) return true;
    // Cloudflare documents this as a cross-zone Worker visitor, not a proxy
    // through which we should continue trusting caller-supplied addresses.
    if (address.toString() === '2a06:98c0:3600::103') return false;
    return matches(address, cloudflare);
  } catch { return false; }
}

function trustedProxy(config) {
  return config.TRUST_PROXY_MODE === 'cloudflare-render'
    ? cloudflareRenderProxy
    : config.trustProxy ?? (config.hostedDemo ? 1 : false);
}

module.exports = { trustedProxy, cloudflareRenderProxy, CLOUDFLARE_CIDRS };
