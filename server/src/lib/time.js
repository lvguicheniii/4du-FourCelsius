const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatCst(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid date value');
  const shifted = new Date(date.getTime() + CST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

function nowCst() {
  return formatCst(new Date());
}

function parseCst(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
    ? text
    : `${text.replace(' ', 'T')}+08:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addCst({ hours = 0, days = 0 } = {}) {
  return formatCst(new Date(Date.now() + hours * 3600000 + days * 86400000));
}

module.exports = { CST_OFFSET_MS, formatCst, nowCst, parseCst, addCst };
