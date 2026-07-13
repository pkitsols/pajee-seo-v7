'use strict';

const COMMON_MULTI_LABEL_SUFFIXES = new Set([
  'com.pk','net.pk','org.pk','edu.pk','gov.pk','biz.pk','web.pk','fam.pk',
  'co.uk','org.uk','gov.uk','ac.uk','com.au','net.au','org.au','co.nz',
  'co.in','firm.in','net.in','org.in','gen.in','ind.in','co.jp','co.za',
  'com.bd','com.sg','com.my','com.tr','com.br','com.mx','com.ng','com.sa','com.ae'
]);

function hostnameFrom(input) {
  try {
    const value = /^https?:\/\//i.test(String(input || '')) ? String(input) : `https://${input}`;
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(input || '').toLowerCase().replace(/^www\./, '').split('/')[0];
  }
}

function registrableDomain(input) {
  const host = hostnameFrom(input).replace(/\.$/, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (COMMON_MULTI_LABEL_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

function normaliseSiteUrl(value) {
  const text = String(value || '').trim();
  if (!text) return { raw: '', hostname: '', origin: '', domain: '' };
  if (text.startsWith('sc-domain:')) {
    const hostname = text.slice('sc-domain:'.length).toLowerCase().replace(/^www\./, '');
    return { raw: text, hostname, origin: '', domain: registrableDomain(hostname) };
  }
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return {
      raw: text,
      hostname: url.hostname.toLowerCase().replace(/^www\./, ''),
      origin: url.origin,
      domain: registrableDomain(url.hostname)
    };
  } catch {
    const hostname = hostnameFrom(text);
    return { raw: text, hostname, origin: '', domain: registrableDomain(hostname) };
  }
}

function propertyMatchScore(target, candidate) {
  const left = normaliseSiteUrl(target);
  const right = normaliseSiteUrl(candidate);
  if (!left.hostname || !right.hostname) return 0;
  if (left.raw === right.raw) return 100;
  if (left.origin && right.origin && left.origin === right.origin) return 96;
  if (left.hostname === right.hostname) return 92;
  if (left.domain && left.domain === right.domain) return 80;
  if (left.hostname.endsWith(`.${right.hostname}`) || right.hostname.endsWith(`.${left.hostname}`)) return 72;
  return 0;
}

function percentChange(current, previous) {
  const a = Number(current || 0);
  const b = Number(previous || 0);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b === 0) return a === 0 ? 0 : null;
  return ((a - b) / Math.abs(b)) * 100;
}

function previousDateRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const days = Math.round((end - start) / 86400000) + 1;
  const previousEnd = new Date(start.getTime() - 86400000);
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86400000);
  const iso = (date) => date.toISOString().slice(0, 10);
  return { startDate: iso(previousStart), endDate: iso(previousEnd) };
}

function scoreBand(value, good = 90, needs = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'unknown';
  if (number >= good) return 'good';
  if (number >= needs) return 'needs-improvement';
  return 'poor';
}

module.exports = {
  hostnameFrom,
  registrableDomain,
  normaliseSiteUrl,
  propertyMatchScore,
  percentChange,
  previousDateRange,
  scoreBand
};
