const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTemperature } = require('../src/utils/temperature');

test('each post refrigerant lowers its calculated temperature by one degree', () => {
  const createdAt = new Date();
  const withoutRefrigerant = calculateTemperature(0, createdAt, createdAt, 'daily', 0);
  const withTwoRefrigerants = calculateTemperature(0, createdAt, createdAt, 'daily', 2);

  assert.equal(withTwoRefrigerants, withoutRefrigerant - 2);
});
