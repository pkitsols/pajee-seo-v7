'use strict';

const { send, cors, publicUrl, query } = require('../api-lib');

async function fetchJson(url, options = {}, timeout = 55000) {
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

module.exports = async function pagespeed(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const paramsFromRequest = query(req);
    const url = await publicUrl(paramsFromRequest.url);
    const strategy = paramsFromRequest.strategy === 'desktop' ? 'desktop' : 'mobile';
    const params = new URLSearchParams({ url, strategy, locale: 'en' });
    ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'].forEach((category) =>
      params.append('category', category)
    );
    if (process.env.GOOGLE_PAGESPEED_API_KEY) {
      params.set('key', process.env.GOOGLE_PAGESPEED_API_KEY);
    }

    const { response, data } = await fetchJson(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`
    );
    if (!response.ok) {
      throw new Error(data.error?.message || 'PageSpeed request failed.');
    }

    let crux = null;
    if (process.env.GOOGLE_CRUX_API_KEY) {
      try {
        const cruxResult = await fetchJson(
          `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(
            process.env.GOOGLE_CRUX_API_KEY
          )}`,
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
          25000
        );
        if (cruxResult.response.ok && cruxResult.data.record) crux = cruxResult.data.record;
      } catch {
        crux = null;
      }
    }

    const lighthouse = data.lighthouseResult || {};
    const audits = lighthouse.audits || {};
    const categories = lighthouse.categories || {};
    const score = (key) =>
      categories[key]?.score == null ? null : Math.round(categories[key].score * 100);
    const metric = (id, label) => ({
      label,
      displayValue: audits[id]?.displayValue || 'Not available',
      numericValue: audits[id]?.numericValue ?? null,
      score: audits[id]?.score ?? null
    });

    const opportunities = Object.values(audits)
      .filter((audit) => audit.details?.type === 'opportunity' && audit.score !== 1)
      .sort(
        (left, right) =>
          (right.details?.overallSavingsMs || 0) - (left.details?.overallSavingsMs || 0)
      )
      .slice(0, 12)
      .map((audit) => ({
        status: audit.score != null && audit.score < 0.5 ? 'fail' : 'warn',
        title: audit.title,
        detail:
          audit.displayValue ||
          audit.description?.replace(/\[.*?\]\(.*?\)/g, '').slice(0, 300) ||
          '',
        savingsMs: audit.details?.overallSavingsMs || 0
      }));

    return send(res, 200, {
      source: 'Google PageSpeed Insights',
      dataType: 'Verified Google performance test',
      strategy,
      finalUrl: lighthouse.finalUrl || url,
      fetchedAt: new Date().toISOString(),
      scores: {
        performance: score('performance'),
        accessibility: score('accessibility'),
        bestPractices: score('best-practices'),
        seo: score('seo')
      },
      metrics: {
        LCP: metric('largest-contentful-paint', 'LCP'),
        INP: metric('interaction-to-next-paint', 'INP'),
        CLS: metric('cumulative-layout-shift', 'CLS'),
        FCP: metric('first-contentful-paint', 'FCP'),
        TTFB: metric('server-response-time', 'TTFB'),
        SpeedIndex: metric('speed-index', 'Speed Index')
      },
      fieldData: data.loadingExperience || null,
      crux,
      opportunities
    });
  } catch (error) {
    return send(res, 400, {
      message:
        error.name === 'AbortError'
          ? 'The PageSpeed request timed out. Please try again.'
          : error.message
    });
  }
};
