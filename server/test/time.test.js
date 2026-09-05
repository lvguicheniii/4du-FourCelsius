const test = require('node:test');
const assert = require('node:assert/strict');
const { formatCst, parseCst } = require('../src/lib/time');

test('formatCst persists an instant as a zone-less Beijing timestamp', () => {
  assert.equal(formatCst(new Date('2026-01-01T00:00:00.000Z')), '2026-01-01 08:00:00');
});

test('parseCst interprets zone-less database timestamps as UTC+8', () => {
  assert.equal(parseCst('2026-01-01 08:00:00').toISOString(), '2026-01-01T00:00:00.000Z');
});

test('parseCst preserves timestamps that already include a zone', () => {
  assert.equal(parseCst('2026-01-01T08:00:00+08:00').toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(parseCst('2026-01-01T00:00:00Z').toISOString(), '2026-01-01T00:00:00.000Z');
});

test('parseCst rejects invalid values', () => {
  assert.equal(parseCst('not-a-date'), null);
  assert.equal(parseCst(null), null);
});
