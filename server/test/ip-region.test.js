const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIp, resolveIpRegion, shortRegionName } = require('../src/lib/ip-region');

test('normalizes IPv4-mapped addresses and rejects invalid input', () => {
  assert.equal(normalizeIp('::ffff:120.24.78.68'), '120.24.78.68');
  assert.equal(normalizeIp('not-an-ip'), '');
});

test('returns coarse regions without exposing the full address', () => {
  assert.equal(resolveIpRegion('120.24.78.68'), '广东');
  assert.equal(resolveIpRegion('192.168.1.5'), '未知');
  assert.equal(shortRegionName('广西壮族自治区'), '广西');
  assert.equal(shortRegionName('香港特别行政区'), '香港');
});
