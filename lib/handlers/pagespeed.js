'use strict';

const { send, cors, publicUrl, query, page } = require('../api-lib');

async function fetchJson(url, options = {}, timeout = 55000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json();
    return { response, data };
  } finally { clearTimeout(timer); }
}
function scoreStatus(score) {
  if (score == null) return 'unknown';
  return score >= 90 ? 'good' : score >= 50 ? 'needs-improvement' : 'poor';
}
function metricStatus(name, value) {
  if (value == null) return 'unknown';
  const limits = {
    LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800], TBT: [200, 600]
  }[name];
  if (!limits) return 'unknown';
  return value <= limits[0] ? 'good' : value <= limits[1] ? 'needs-improvement' : 'poor';
}
function bytes(value) {
  const n = Number(value || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
const FIXES = {
  'unused-css-rules': 'Remove unused selectors, split page-specific CSS, purge framework output, and load non-critical styles after the first render.',
  'unused-javascript': 'Remove unused bundles, tree-shake dependencies, code-split by route, delay third-party scripts, and load non-critical JavaScript after interaction.',
  'render-blocking-resources': 'Inline critical CSS, defer non-critical styles, add defer/async to safe scripts, and preload only the resources required above the fold.',
  'largest-contentful-paint-element': 'Optimise and preload the LCP asset, reduce server response time, avoid lazy-loading the hero image, and remove render-blocking work before it paints.',
  'layout-shifts': 'Reserve width and height for images, embeds and ads; avoid inserting content above existing elements; and stabilise fonts with appropriate preload and fallback metrics.',
  'long-tasks': 'Break long JavaScript tasks into smaller work, reduce main-thread execution, move heavy processing to web workers, and delay optional scripts.',
  'bootup-time': 'Reduce JavaScript parse and execution cost, ship smaller bundles, remove duplicate libraries, and defer third-party code.',
  'mainthread-work-breakdown': 'Reduce script evaluation, style recalculation and layout work; simplify DOM structure and limit expensive client-side rendering.',
  'server-response-time': 'Improve hosting, caching, database queries and backend processing; use a CDN and full-page caching where appropriate.',
  'offscreen-images': 'Lazy-load below-the-fold images while keeping the hero/LCP image eager.',
  'uses-optimized-images': 'Compress images, use AVIF/WebP, resize to rendered dimensions and avoid oversized originals.',
  'uses-responsive-images': 'Use srcset and sizes so each device downloads an appropriately sized image.'
};
function cleanDescription(value = '') { return String(value).replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1').replace(/\s+/g, ' ').trim(); }
function auditItems(audit) {
  const items = Array.isArray(audit?.details?.items) ? audit.details.items : [];
  return items.slice(0, 30).map((item) => ({
    url: item.url || item.source?.url || item.node?.snippet || '',
    selector: item.node?.selector || '',
    snippet: item.node?.snippet || item.source || '',
    totalBytes: Number(item.totalBytes || 0), wastedBytes: Number(item.wastedBytes || 0),
    totalMs: Number(item.total || item.duration || item.wastedMs || 0),
    score: item.score ?? null,
    display: item.displayValue || ''
  }));
}
function cruxP75(record, key) {
  const value = record?.metrics?.[key]?.percentiles?.p75;
  return value == null ? null : Number(value);
}
function fieldMetric(record, key, label) {
  const value = cruxP75(record, key);
  return { label, value, status: metricStatus(label, value), source: value == null ? 'CrUX field data unavailable' : 'CrUX p75 real-user field data' };
}
function metric(audits, id, label) {
  const a = audits[id];
  return { label, displayValue: a?.displayValue || 'Not available', numericValue: a?.numericValue ?? null, score: a?.score ?? null, status: metricStatus(label, a?.numericValue ?? null) };
}

module.exports = async function pagespeed(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });
  try {
    const request = query(req);
    const url = await publicUrl(request.url);
    const strategy = request.strategy === 'desktop' ? 'desktop' : 'mobile';
    const params = new URLSearchParams({ url, strategy, locale: 'en' });
    ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'].forEach((category) => params.append('category', category));
    if (process.env.GOOGLE_PAGESPEED_API_KEY) params.set('key', process.env.GOOGLE_PAGESPEED_API_KEY);
    const [{ response, data }, website] = await Promise.all([
      fetchJson(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`),
      page(url).catch(() => null)
    ]);
    if (!response.ok) throw new Error(data.error?.message || 'PageSpeed request failed.');

    let cruxRecord = null;
    if (process.env.GOOGLE_CRUX_API_KEY) {
      try {
        const crux = await fetchJson(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(process.env.GOOGLE_CRUX_API_KEY)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            formFactor: strategy === 'desktop' ? 'DESKTOP' : 'PHONE',
            metrics: ['largest_contentful_paint','interaction_to_next_paint','cumulative_layout_shift','first_contentful_paint','experimental_time_to_first_byte']
          })
        }, 25000);
        if (crux.response.ok && crux.data.record) cruxRecord = crux.data.record;
      } catch { cruxRecord = null; }
    }

    const lighthouse = data.lighthouseResult || {};
    const audits = lighthouse.audits || {};
    const categories = lighthouse.categories || {};
    const categoryScore = (key) => categories[key]?.score == null ? null : Math.round(categories[key].score * 100);
    const scores = {
      performance: categoryScore('performance'), accessibility: categoryScore('accessibility'),
      bestPractices: categoryScore('best-practices'), seo: categoryScore('seo')
    };
    const screenshot = audits['final-screenshot']?.details?.data || audits['screenshot-thumbnails']?.details?.items?.slice(-1)?.[0]?.data || '';
    const auditIds = [
      'largest-contentful-paint-element','layout-shifts','unused-css-rules','unused-javascript','render-blocking-resources',
      'long-tasks','bootup-time','mainthread-work-breakdown','server-response-time','offscreen-images','uses-optimized-images','uses-responsive-images'
    ];
    const diagnostics = auditIds.map((id) => {
      const a = audits[id]; if (!a || a.score === 1 || a.scoreDisplayMode === 'notApplicable') return null;
      const items = auditItems(a);
      return {
        id, status: a.score != null && a.score < 0.5 ? 'poor' : 'needs-improvement',
        title: a.title || id, description: cleanDescription(a.description || ''), displayValue: a.displayValue || '',
        savingsMs: Number(a.details?.overallSavingsMs || 0), savingsBytes: Number(a.details?.overallSavingsBytes || 0),
        fix: FIXES[id] || 'Review the affected resources and reduce the work required before the page becomes stable and interactive.', items
      };
    }).filter(Boolean).sort((a,b) => (b.savingsMs + b.savingsBytes / 1000) - (a.savingsMs + a.savingsBytes / 1000));

    const lab = {
      LCP: metric(audits, 'largest-contentful-paint', 'LCP'),
      CLS: metric(audits, 'cumulative-layout-shift', 'CLS'),
      FCP: metric(audits, 'first-contentful-paint', 'FCP'),
      TTFB: metric(audits, 'server-response-time', 'TTFB'),
      TBT: metric(audits, 'total-blocking-time', 'TBT'),
      SpeedIndex: metric(audits, 'speed-index', 'Speed Index')
    };
    const field = {
      LCP: fieldMetric(cruxRecord, 'largest_contentful_paint', 'LCP'),
      INP: fieldMetric(cruxRecord, 'interaction_to_next_paint', 'INP'),
      CLS: fieldMetric(cruxRecord, 'cumulative_layout_shift', 'CLS'),
      FCP: fieldMetric(cruxRecord, 'first_contentful_paint', 'FCP'),
      TTFB: fieldMetric(cruxRecord, 'experimental_time_to_first_byte', 'TTFB')
    };
    const cwvPass = ['LCP','INP','CLS'].every((key) => field[key].status === 'good');
    return send(res, 200, {
      source: 'Google PageSpeed Insights + Chrome UX Report', dataType: 'Verified Google performance test', strategy,
      site: { name: website?.siteName || new URL(url).hostname, url: lighthouse.finalUrl || url, favicon: website?.favicon || '', title: website?.title || '', screenshot },
      fetchedAt: new Date().toISOString(), scores,
      scoreStatus: Object.fromEntries(Object.entries(scores).map(([k,v]) => [k, scoreStatus(v)])),
      labMetrics: lab,
      fieldMetrics: field,
      coreWebVitals: { passed: cruxRecord ? cwvPass : null, source: cruxRecord ? 'CrUX p75 field data' : 'Not enough CrUX field data', notice: cruxRecord ? 'INP is shown only from real-user CrUX field data.' : 'INP cannot be inferred from Lighthouse. No real-user CrUX INP data was available for this URL/form factor.' },
      diagnostics,
      opportunitySummary: diagnostics.slice(0, 8).map((item) => ({ id: item.id, title: item.title, status: item.status, displayValue: item.displayValue, savingsMs: item.savingsMs, savingsBytes: item.savingsBytes, savingsLabel: item.savingsBytes ? bytes(item.savingsBytes) : '' })),
      lighthouseVersion: lighthouse.lighthouseVersion || ''
    });
  } catch (error) {
    return send(res, 400, { message: error.name === 'AbortError' ? 'The PageSpeed request timed out. Please try again.' : error.message });
  }
};
