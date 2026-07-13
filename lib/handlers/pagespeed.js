'use strict';

const { send, cors, publicUrl, query } = require('../api-lib');
const { scoreBand } = require('../domain-utils');

async function fetchJson(url, options = {}, timeout = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json();
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

function auditMetric(audits, id, label, unit = 'ms') {
  const audit = audits[id] || {};
  return {
    id,
    label,
    displayValue: audit.displayValue || 'Not available',
    numericValue: audit.numericValue ?? null,
    score: audit.score ?? null,
    unit
  };
}

function p75(record, key) {
  const value = record?.metrics?.[key]?.percentiles?.p75;
  return value == null ? null : Number(value);
}

function classifyField(metric, value) {
  if (value == null || !Number.isFinite(Number(value))) return 'unknown';
  const number = Number(value);
  if (metric === 'LCP') return number <= 2500 ? 'good' : number <= 4000 ? 'needs-improvement' : 'poor';
  if (metric === 'INP') return number <= 200 ? 'good' : number <= 500 ? 'needs-improvement' : 'poor';
  if (metric === 'CLS') return number <= 0.1 ? 'good' : number <= 0.25 ? 'needs-improvement' : 'poor';
  if (metric === 'FCP') return number <= 1800 ? 'good' : number <= 3000 ? 'needs-improvement' : 'poor';
  if (metric === 'TTFB') return number <= 800 ? 'good' : number <= 1800 ? 'needs-improvement' : 'poor';
  return 'unknown';
}

function cleanDescription(value = '') {
  return String(value)
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractItems(audit) {
  const items = Array.isArray(audit?.details?.items) ? audit.details.items : [];
  return items.slice(0, 80).map((item) => ({
    url: item.url || item.source?.url || item.node?.snippet || '',
    totalBytes: Number(item.totalBytes || item.resourceSize || 0),
    wastedBytes: Number(item.wastedBytes || 0),
    wastedPercent: Number(item.wastedPercent || 0),
    wastedMs: Number(item.wastedMs || item.duration || 0),
    transferSize: Number(item.transferSize || 0),
    snippet: item.node?.snippet || '',
    selector: item.node?.selector || '',
    requestCount: Number(item.requestCount || 0)
  })).filter((item) => item.url || item.snippet || item.wastedBytes || item.wastedMs);
}

function opportunity(audit) {
  const score = audit.score == null ? null : Number(audit.score);
  return {
    id: audit.id,
    status: score == null ? 'info' : score < 0.5 ? 'fail' : score < 0.9 ? 'warn' : 'pass',
    title: audit.title || audit.id,
    description: cleanDescription(audit.description).slice(0, 600),
    displayValue: audit.displayValue || '',
    savingsMs: Number(audit.details?.overallSavingsMs || 0),
    savingsBytes: Number(audit.details?.overallSavingsBytes || 0),
    score,
    items: extractItems(audit)
  };
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

    const { response, data } = await fetchJson(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`);
    if (!response.ok) throw new Error(data.error?.message || 'PageSpeed request failed.');

    let crux = null;
    if (process.env.GOOGLE_CRUX_API_KEY) {
      try {
        const cruxResult = await fetchJson(
          `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(process.env.GOOGLE_CRUX_API_KEY)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url,
              formFactor: strategy === 'desktop' ? 'DESKTOP' : 'PHONE',
              metrics: [
                'largest_contentful_paint',
                'interaction_to_next_paint',
                'cumulative_layout_shift',
                'first_contentful_paint',
                'experimental_time_to_first_byte'
              ]
            })
          },
          30000
        );
        if (cruxResult.response.ok && cruxResult.data.record) crux = cruxResult.data.record;
      } catch {
        crux = null;
      }
    }

    const lighthouse = data.lighthouseResult || {};
    const audits = lighthouse.audits || {};
    const categories = lighthouse.categories || {};
    const score = (key) => categories[key]?.score == null ? null : Math.round(categories[key].score * 100);
    const scores = {
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo')
    };

    const labMetrics = {
      LCP: auditMetric(audits, 'largest-contentful-paint', 'Largest Contentful Paint'),
      CLS: auditMetric(audits, 'cumulative-layout-shift', 'Cumulative Layout Shift', 'score'),
      FCP: auditMetric(audits, 'first-contentful-paint', 'First Contentful Paint'),
      TTFB: auditMetric(audits, 'server-response-time', 'Time to First Byte'),
      SpeedIndex: auditMetric(audits, 'speed-index', 'Speed Index'),
      TBT: auditMetric(audits, 'total-blocking-time', 'Total Blocking Time')
    };

    const fieldValues = {
      LCP: p75(crux, 'largest_contentful_paint'),
      INP: p75(crux, 'interaction_to_next_paint'),
      CLS: p75(crux, 'cumulative_layout_shift'),
      FCP: p75(crux, 'first_contentful_paint'),
      TTFB: p75(crux, 'experimental_time_to_first_byte')
    };
    const fieldMetrics = Object.fromEntries(Object.entries(fieldValues).map(([key, value]) => [key, {
      value,
      status: classifyField(key, value),
      available: value != null
    }]));
    const cwvPass = ['LCP','INP','CLS'].every((key) => fieldMetrics[key].status === 'good');
    const cwvAvailable = ['LCP','INP','CLS'].every((key) => fieldMetrics[key].available);

    const opportunityAudits = Object.values(audits)
      .filter((audit) => audit?.details?.type === 'opportunity' && audit.score !== 1)
      .sort((a, b) => Number(b.details?.overallSavingsMs || b.details?.overallSavingsBytes || 0) - Number(a.details?.overallSavingsMs || a.details?.overallSavingsBytes || 0))
      .slice(0, 18)
      .map(opportunity);

    const diagnostics = [
      'unused-css-rules','unused-javascript','render-blocking-resources','uses-optimized-images',
      'modern-image-formats','uses-responsive-images','offscreen-images','uses-text-compression',
      'uses-long-cache-ttl','total-byte-weight','dom-size','long-tasks','mainthread-work-breakdown',
      'third-party-summary','font-display','largest-contentful-paint-element','layout-shift-elements'
    ].map((id) => ({ ...audits[id], id })).filter((audit) => audit.title && audit.score !== 1).map(opportunity);

    const screenshot = audits['final-screenshot']?.details?.data || '';

    return send(res, 200, {
      source: 'Google PageSpeed Insights + Chrome UX Report',
      dataType: 'Verified Google performance test',
      strategy,
      requestedUrl: url,
      finalUrl: lighthouse.finalUrl || url,
      fetchedAt: new Date().toISOString(),
      scores: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, { value, status: scoreBand(value) }])),
      labMetrics,
      fieldMetrics,
      coreWebVitals: {
        available: cwvAvailable,
        passed: cwvAvailable ? cwvPass : null,
        assessment: cwvAvailable ? (cwvPass ? 'Passed' : 'Not passed') : 'Not enough field data',
        collectionPeriod: crux?.collectionPeriod || null,
        notice: cwvAvailable
          ? 'Field metrics are p75 values from CrUX real-user data.'
          : 'INP and the complete Core Web Vitals assessment require sufficient CrUX field data. TBT is not presented as INP.'
      },
      screenshot,
      opportunities: opportunityAudits,
      diagnostics,
      rawFieldDataAvailable: Boolean(crux),
      notes: [
        'Lighthouse lab data and CrUX field data are shown separately.',
        'INP is reported only from real-user field data when available.'
      ]
    });
  } catch (error) {
    return send(res, 400, {
      message: error.name === 'AbortError' ? 'The PageSpeed request timed out. Please try again.' : error.message
    });
  }
};
