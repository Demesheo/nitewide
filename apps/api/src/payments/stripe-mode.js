function isStripeMode(mode) { return mode === 'test' || mode === 'live'; }

function stripeLivemode(mode) { return isStripeMode(mode) ? mode === 'live' : null; }

function matchesStripeLivemode(object, mode) {
  const expected = stripeLivemode(mode);
  return expected !== null && object?.livemode === expected;
}

module.exports = { isStripeMode, stripeLivemode, matchesStripeLivemode };
