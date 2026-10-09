// Classify formats only: prefixes do not prove platform identity or provider
// permissions. Restricted server credentials must never pass as browser keys.
function keyMode(value, pattern) {
  if (typeof value !== 'string') return null;
  const match = value.match(pattern);
  return match && match[0] === value ? match[1] : null;
}

function stripeServerKeyMode(value) {
  return keyMode(value, /^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/);
}

function stripePublishableKeyMode(value) {
  return keyMode(value, /^pk_(test|live)_[A-Za-z0-9]+$/);
}

module.exports = { stripeServerKeyMode, stripePublishableKeyMode };
