const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adminHtml = fs.readFileSync(path.join(__dirname, '../src/public/admin/index.html'), 'utf8');
const pagesBuilder = fs.readFileSync(path.join(__dirname, '../scripts/build-admin-pages.mjs'), 'utf8');

function loadCalendarNormalizer() {
  const source = adminHtml.match(/function normalizedCalendarMonth\(year,month\)\{[\s\S]+?\}\r?\nfunction renderThemeCalendar/)?.[0]
    ?.replace(/\r?\nfunction renderThemeCalendar$/, '');
  assert.ok(source, 'calendar month normalizer must exist');
  const context = {};
  vm.runInNewContext(`${source}; result = normalizedCalendarMonth;`, context);
  return context.result;
}

test('admin calendar follows Gregorian month and year boundaries', () => {
  const normalize = loadCalendarNormalizer();
  assert.deepEqual({ ...normalize(2026, 11) }, { year: 2026, month: 11 });
  assert.deepEqual({ ...normalize(2026, 12) }, { year: 2027, month: 0 });
  assert.deepEqual({ ...normalize(2027, -1) }, { year: 2026, month: 11 });
  assert.equal(new Date(2028, 2, 0).getDate(), 29, '2028 is a leap year');
  assert.equal(new Date(2100, 2, 0).getDate(), 28, '2100 is not a leap year');
  assert.equal(new Date(2000, 2, 0).getDate(), 29, '2000 is a leap year');
  assert.equal(new Date(2026, 4, 0).getDate(), 30, 'April has 30 days');
  assert.equal(new Date(2026, 8, 0).getDate(), 31, 'August has 31 days');
});

test('admin calendar closes when pointer interaction is outside its date wrapper', () => {
  assert.match(adminHtml, /document\.addEventListener\('pointerdown'/);
  assert.match(adminHtml, /!event\.target\.closest\('\.theme-date-wrap'\)\)closeThemeCalendar\(\)/);
});

test('reef application avatars allow signed private COS images and retain a fallback', () => {
  assert.match(adminHtml, /avatarMarkup\(a\.avatar,name,'reef-application-avatar'\)/);
  assert.match(adminHtml, /referrerpolicy="no-referrer"/);
  assert.match(adminHtml, /class="avatar-fallback"/);
  assert.match(pagesBuilder, /img-src[^\n]+https:\/\/\*\.myqcloud\.com/);
});
