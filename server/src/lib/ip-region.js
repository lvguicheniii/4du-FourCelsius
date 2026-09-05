const net = require('net');

let searcher;

function normalizeIp(value) {
  let ip = String(value || '').trim();
  if (!ip) return '';
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']'));
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);
  return net.isIP(ip) ? ip : '';
}

function getRequestIp(req) {
  return normalizeIp(req?.ip || req?.socket?.remoteAddress || '');
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '0.0.0.0') return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(ip);
}

function shortRegionName(value) {
  return String(value || '')
    .replace(/特别行政区$/, '')
    .replace(/维吾尔自治区$/, '')
    .replace(/壮族自治区$/, '')
    .replace(/回族自治区$/, '')
    .replace(/自治区$/, '')
    .replace(/[省市]$/, '')
    .trim();
}

function getSearcher() {
  if (!searcher) {
    const moduleValue = require('ip2region');
    const IP2Region = moduleValue.default || moduleValue;
    searcher = new IP2Region();
  }
  return searcher;
}

function resolveIpRegion(value) {
  const ip = normalizeIp(value);
  if (!ip || isPrivateIp(ip)) return '未知';
  try {
    const result = getSearcher().search(ip);
    if (!result) return '未知';
    const country = shortRegionName(result.country);
    const province = shortRegionName(result.province);
    if (country === '中国') return province || shortRegionName(result.city) || '中国';
    return country || province || '未知';
  } catch {
    return '未知';
  }
}

function getUserIpRegion(user) {
  return resolveIpRegion(user?.last_login_ip || user?.register_ip || '');
}

module.exports = { getRequestIp, getUserIpRegion, normalizeIp, resolveIpRegion, shortRegionName };
