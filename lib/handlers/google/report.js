'use strict';

const { send, getBody, cleanText, fetchText, publicUrl } = require('../../api-lib');
const { tokens } = require('../../google-auth');

function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)); }
function validateRange(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate)) throw new Error('Choose a valid start and end date.');
  if (Date.parse(startDate) > Date.parse(endDate)) throw new Error('The start date must be before the end date.');
}
function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1; }
function previousRange(startDate, endDate) {
  const days = daysBetween(startDate, endDate);
  const end = new Date(Date.parse(startDate) - 86400000);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function change(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}
function gscTotals(row) {
  return {
    clicks: number(row?.clicks), impressions: number(row?.impressions), ctr: number(row?.ctr), position: number(row?.position)
  };
}
function gscRow(row) {
  return { key: row.keys?.[0] || '', clicks: number(row.clicks), impressions: number(row.impressions), ctr: number(row.ctr), position: number(row.position) };
}
function gaMetric(row, index) { return number(row?.metricValues?.[index]?.value); }
function metricObject(current, previous) {
  return { current, previous, change: change(current, previous) };
}
async function googleJson(url, headers, body, timeout = 30000) {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Google report request failed.');
  return data;
}
async function searchQuery(headers, property, body) {
  return googleJson(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, headers, body);
}
async function gaReport(headers, property, body) {
  return googleJson(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(property)}:runReport`, headers, body);
}
function parseLocs(xml, origin) {
  return [...String(xml || '').matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((m) => m[1].trim().replace(/&amp;/g, '&'))
    .filter((url) => { try { return new URL(url).origin === origin; } catch { return false; } });
}
async function sitemapUrls(targetUrl, max = 500) {
  const safe = await publicUrl(targetUrl);
  const origin = new URL(safe).origin;
  let robots = '';
  try { const r = await fetchText(`${origin}/robots.txt`, { timeout: 8000, max: 300000, accept: 'text/plain,*/*' }); if (r.response.ok) robots = r.text; } catch {}
  const queue = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  for (const m of robots.matchAll(/^sitemap:\s*(.+)$/gim)) queue.unshift(m[1].trim());
  const visited = new Set(), urls = [], files = [];
  while (queue.length && visited.size < 20 && urls.length < max) {
    const candidate = queue.shift(); if (visited.has(candidate)) continue; visited.add(candidate);
    try {
      const r = await fetchText(candidate, { timeout: 10000, max: 1800000, accept: 'application/xml,text/xml,text/plain' });
      if (!r.response.ok) continue;
      const locs = parseLocs(r.text, origin); const index = /<sitemapindex\b/i.test(r.text);
      files.push({ url: candidate, count: locs.length, type: index ? 'index' : 'urlset' });
      if (index) queue.push(...locs.slice(0, 20)); else urls.push(...locs);
    } catch {}
  }
  return { urls: [...new Set(urls)].slice(0, max), files };
}
async function inspectUrl(headers, property, url) {
  try {
    const response = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST', headers, body: JSON.stringify({ inspectionUrl: url, siteUrl: property, languageCode: 'en-US' }), signal: AbortSignal.timeout(18000)
    });
    const data = await response.json();
    if (!response.ok) return { available: false, message: data.error?.message || 'Inspection unavailable' };
    const result = data.inspectionResult?.indexStatusResult || {};
    return {
      available: true,
      verdict: result.verdict || '',
      coverageState: result.coverageState || '',
      indexingState: result.indexingState || '',
      robotsTxtState: result.robotsTxtState || '',
      pageFetchState: result.pageFetchState || '',
      lastCrawlTime: result.lastCrawlTime || '',
      googleCanonical: result.googleCanonical || '',
      userCanonical: result.userCanonical || ''
    };
  } catch (error) { return { available: false, message: error.message }; }
}
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length); let cursor = 0;
  async function run() { while (cursor < items.length) { const i = cursor++; try { out[i] = await worker(items[i]); } catch (e) { out[i] = { available: false, message: e.message }; } } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

async function gscReport(headers, property, body, startDate, endDate, compare) {
  const previous = compare?.enabled ? { startDate: compare.startDate, endDate: compare.endDate } : previousRange(startDate, endDate);
  const pageSize = [25, 50, 100].includes(Number(body.pageSize)) ? Number(body.pageSize) : 25;
  const pageNumber = Math.max(1, Number(body.page) || 1);
  const startRow = (pageNumber - 1) * pageSize;
  const view = cleanText(body.view, 'query');

  if (view === 'sitemap') {
    const discovered = await sitemapUrls(body.targetUrl || property.replace(/^sc-domain:/, 'https://'), 500);
    const allPerformance = await searchQuery(headers, property, { startDate, endDate, dimensions: ['page'], rowLimit: 25000, dataState: 'final' });
    const perfMap = new Map((allPerformance.rows || []).map((row) => [row.keys?.[0] || '', gscRow(row)]));
    const total = discovered.urls.length;
    const slice = discovered.urls.slice(startRow, startRow + pageSize);
    const inspected = body.includeInspection === false ? [] : await mapLimit(slice.slice(0, 25), 4, (url) => inspectUrl(headers, property, url));
    const rows = slice.map((url, index) => ({ url, ...(perfMap.get(url) || { clicks: 0, impressions: 0, ctr: 0, position: 0 }), inspection: inspected[index] || null }));
    return {
      sourceLabel: 'Google Search Console', dataType: 'Verified Google Data', view: 'sitemap', dateRange: { startDate, endDate },
      sitemapFiles: discovered.files, metrics: { sitemapUrls: total, urlsWithImpressions: discovered.urls.filter((u) => (perfMap.get(u)?.impressions || 0) > 0).length },
      rows, pagination: { page: pageNumber, pageSize, totalRows: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
    };
  }

  const dimensionMap = { query: 'query', page: 'page', country: 'country', device: 'device', appearance: 'searchAppearance', date: 'date' };
  const dimension = dimensionMap[body.dimension] || 'query';
  const [summaryCurrent, summaryPrevious, trendCurrent, trendPrevious, tableCurrent, tablePrevious] = await Promise.all([
    searchQuery(headers, property, { startDate, endDate, rowLimit: 1, dataState: 'final' }),
    searchQuery(headers, property, { startDate: previous.startDate, endDate: previous.endDate, rowLimit: 1, dataState: 'final' }),
    searchQuery(headers, property, { startDate, endDate, dimensions: ['date'], rowLimit: 25000, dataState: 'final' }),
    searchQuery(headers, property, { startDate: previous.startDate, endDate: previous.endDate, dimensions: ['date'], rowLimit: 25000, dataState: 'final' }),
    searchQuery(headers, property, { startDate, endDate, dimensions: [dimension], rowLimit: pageSize, startRow, dataState: 'final' }),
    searchQuery(headers, property, { startDate: previous.startDate, endDate: previous.endDate, dimensions: [dimension], rowLimit: 25000, dataState: 'final' })
  ]);
  const currentTotals = gscTotals(summaryCurrent.rows?.[0]);
  const previousTotals = gscTotals(summaryPrevious.rows?.[0]);
  const prevMap = new Map((tablePrevious.rows || []).map((row) => { const parsed = gscRow(row); return [parsed.key, parsed]; }));
  const rows = (tableCurrent.rows || []).map((row) => {
    const current = gscRow(row); const prior = prevMap.get(current.key) || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    return { ...current, previous: prior, changes: { clicks: change(current.clicks, prior.clicks), impressions: change(current.impressions, prior.impressions), ctr: change(current.ctr, prior.ctr), position: prior.position ? current.position - prior.position : 0 } };
  });
  const totalRows = Math.min(50000, startRow + rows.length + (rows.length === pageSize ? pageSize : 0));
  return {
    sourceLabel: 'Google Search Console', dataType: 'Verified Google Data', view: 'performance',
    dateRange: { startDate, endDate }, compareRange: previous,
    metrics: {
      clicks: metricObject(currentTotals.clicks, previousTotals.clicks),
      impressions: metricObject(currentTotals.impressions, previousTotals.impressions),
      ctr: metricObject(currentTotals.ctr, previousTotals.ctr),
      position: { current: currentTotals.position, previous: previousTotals.position, change: previousTotals.position ? currentTotals.position - previousTotals.position : 0 }
    },
    chart: {
      current: (trendCurrent.rows || []).map((row) => ({ date: row.keys?.[0] || '', ...gscRow(row) })),
      previous: (trendPrevious.rows || []).map((row) => ({ date: row.keys?.[0] || '', ...gscRow(row) }))
    },
    dimension, rows,
    opportunities: {
      lowCtr: rows.filter((r) => r.impressions >= 50 && r.ctr < 0.02).slice(0, 10),
      positions4to10: rows.filter((r) => r.position >= 4 && r.position <= 10).slice(0, 10),
      positions11to20: rows.filter((r) => r.position > 10 && r.position <= 20).slice(0, 10)
    },
    pagination: { page: pageNumber, pageSize, startRow, hasNext: rows.length === pageSize, totalRowsEstimate: totalRows }
  };
}

async function ga4Report(headers, property, body, startDate, endDate, compare) {
  const previous = compare?.enabled ? { startDate: compare.startDate, endDate: compare.endDate } : previousRange(startDate, endDate);
  const pageSize = [25, 50, 100].includes(Number(body.pageSize)) ? Number(body.pageSize) : 25;
  const pageNumber = Math.max(1, Number(body.page) || 1);
  const offset = String((pageNumber - 1) * pageSize);
  const dimensionMap = {
    date: 'date', channel: 'sessionDefaultChannelGroup', landing: 'landingPagePlusQueryString',
    country: 'country', city: 'city', device: 'deviceCategory', source: 'sessionSourceMedium'
  };
  const dimension = dimensionMap[body.dimension] || 'sessionDefaultChannelGroup';
  const summaryMetrics = [
    'activeUsers','newUsers','sessions','engagedSessions','engagementRate','screenPageViews','keyEvents','userEngagementDuration'
  ].map((name) => ({ name }));
  const tableMetrics = summaryMetrics;
  const [summaryCurrent, summaryPrevious, trendCurrent, trendPrevious, tableCurrent, tablePrevious] = await Promise.all([
    gaReport(headers, property, { dateRanges: [{ startDate, endDate }], metrics: summaryMetrics }),
    gaReport(headers, property, { dateRanges: [{ startDate: previous.startDate, endDate: previous.endDate }], metrics: summaryMetrics }),
    gaReport(headers, property, { dateRanges: [{ startDate, endDate }], dimensions: [{ name: 'date' }], metrics: summaryMetrics, limit: '400' }),
    gaReport(headers, property, { dateRanges: [{ startDate: previous.startDate, endDate: previous.endDate }], dimensions: [{ name: 'date' }], metrics: summaryMetrics, limit: '400' }),
    gaReport(headers, property, { dateRanges: [{ startDate, endDate }], dimensions: [{ name: dimension }], metrics: tableMetrics, offset, limit: String(pageSize), keepEmptyRows: false }),
    gaReport(headers, property, { dateRanges: [{ startDate: previous.startDate, endDate: previous.endDate }], dimensions: [{ name: dimension }], metrics: tableMetrics, limit: '10000', keepEmptyRows: false })
  ]);
  const summaryRow = summaryCurrent.rows?.[0]; const prevRow = summaryPrevious.rows?.[0];
  const names = ['activeUsers','newUsers','sessions','engagedSessions','engagementRate','screenPageViews','keyEvents','userEngagementDuration'];
  const metrics = Object.fromEntries(names.map((name, i) => [name, metricObject(gaMetric(summaryRow, i), gaMetric(prevRow, i))]));
  const parseRow = (row) => ({
    key: row.dimensionValues?.[0]?.value || '',
    activeUsers: gaMetric(row,0), newUsers: gaMetric(row,1), sessions: gaMetric(row,2), engagedSessions: gaMetric(row,3),
    engagementRate: gaMetric(row,4), views: gaMetric(row,5), keyEvents: gaMetric(row,6), engagementSeconds: gaMetric(row,7)
  });
  const prevMap = new Map((tablePrevious.rows || []).map((row) => { const p = parseRow(row); return [p.key, p]; }));
  const rows = (tableCurrent.rows || []).map((row) => {
    const current = parseRow(row); const prior = prevMap.get(current.key) || {};
    return { ...current, previous: prior, changes: { users: change(current.activeUsers, prior.activeUsers || 0), sessions: change(current.sessions, prior.sessions || 0), engagementRate: change(current.engagementRate, prior.engagementRate || 0), views: change(current.views, prior.views || 0), keyEvents: change(current.keyEvents, prior.keyEvents || 0) } };
  });
  const parseTrend = (report) => (report.rows || []).map((row) => ({ date: row.dimensionValues?.[0]?.value || '', ...parseRow(row) }));
  return {
    sourceLabel: 'Google Analytics 4', dataType: 'Verified Google Data', dateRange: { startDate, endDate }, compareRange: previous,
    metrics, chart: { current: parseTrend(trendCurrent), previous: parseTrend(trendPrevious) }, dimension, rows,
    pagination: { page: pageNumber, pageSize, totalRows: Number(tableCurrent.rowCount || rows.length), totalPages: Math.max(1, Math.ceil(Number(tableCurrent.rowCount || rows.length) / pageSize)) }
  };
}

module.exports = async function googleReport(req, res) {
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed.' });
  try {
    const body = getBody(req);
    const source = body.source === 'gsc' ? 'gsc' : 'ga4';
    const property = cleanText(body.property); const startDate = cleanText(body.startDate); const endDate = cleanText(body.endDate);
    if (!property) throw new Error('Select a Google property.'); validateRange(startDate, endDate);
    const compare = body.compare === false ? { enabled: false } : {
      enabled: true,
      startDate: validDate(body.compareStartDate) ? body.compareStartDate : previousRange(startDate, endDate).startDate,
      endDate: validDate(body.compareEndDate) ? body.compareEndDate : previousRange(startDate, endDate).endDate
    };
    if (compare.enabled) validateRange(compare.startDate, compare.endDate);
    const token = await tokens(req, res);
    const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };
    const result = source === 'gsc'
      ? await gscReport(headers, property, body, startDate, endDate, compare)
      : await ga4Report(headers, property, body, startDate, endDate, compare);
    return send(res, 200, result);
  } catch (error) { return send(res, 400, { message: error.message }); }
};
