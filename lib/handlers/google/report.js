'use strict';

const { send, getBody, cleanText } = require('../../api-lib');
const { tokens } = require('../../google-auth');
const { percentChange, previousDateRange } = require('../../domain-utils');

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
}

function validateRange(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate)) throw new Error('Choose a valid start and end date.');
  if (Date.parse(startDate) > Date.parse(endDate)) throw new Error('The start date must be before the end date.');
  const days = Math.floor((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1;
  if (days > 490) throw new Error('Choose a date range of 490 days or less.');
}

function number(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function metric(label, current, previous, format = 'number', direction = 'up') {
  return {
    label,
    current,
    previous,
    format,
    direction,
    change: percentChange(current, previous)
  };
}

async function googleFetch(url, { method = 'GET', headers = {}, body } = {}, timeout = 30000) {
  const response = await fetch(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message || 'Google report request failed.');
  return data;
}

async function gscQuery(property, headers, startDate, endDate, dimensions = [], options = {}) {
  return googleFetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers,
      body: {
        startDate,
        endDate,
        dimensions,
        rowLimit: options.rowLimit || 1000,
        startRow: options.startRow || 0,
        dataState: 'final',
        type: options.type || 'web',
        dimensionFilterGroups: options.filters || undefined
      }
    },
    35000
  );
}

function gscTotals(data) {
  const row = data.rows?.[0] || {};
  return {
    clicks: number(row.clicks),
    impressions: number(row.impressions),
    ctr: number(row.ctr),
    position: number(row.position)
  };
}

function gscRows(data, dimension) {
  return (data.rows || []).map((row) => ({
    key: row.keys?.[0] || '',
    [dimension]: row.keys?.[0] || '',
    clicks: number(row.clicks),
    impressions: number(row.impressions),
    ctr: number(row.ctr),
    position: number(row.position)
  }));
}

function compareRows(currentRows, previousRows, keyName = 'key') {
  const previous = new Map(previousRows.map((row) => [row[keyName] || row.key, row]));
  return currentRows.map((row) => {
    const old = previous.get(row[keyName] || row.key) || {};
    return {
      ...row,
      previousClicks: number(old.clicks),
      previousImpressions: number(old.impressions),
      clickChange: percentChange(row.clicks, old.clicks),
      impressionChange: percentChange(row.impressions, old.impressions),
      positionChange: old.position ? old.position - row.position : null
    };
  });
}

function gscInsights(queryRows, pageRows, summary, previous) {
  const insights = [];
  const lowCtr = queryRows.filter((row) => row.impressions >= 50 && row.position <= 20 && row.ctr < 0.02).slice(0, 5);
  const striking = queryRows.filter((row) => row.position >= 4 && row.position <= 20).sort((a, b) => b.impressions - a.impressions).slice(0, 5);
  const declining = queryRows.filter((row) => row.clickChange != null && row.clickChange < -20).sort((a, b) => a.clickChange - b.clickChange).slice(0, 5);
  const winners = queryRows.filter((row) => row.clickChange != null && row.clickChange > 20).sort((a, b) => b.clickChange - a.clickChange).slice(0, 5);
  if (lowCtr.length) insights.push({ status: 'warn', title: 'High-impression queries with low CTR', detail: `${lowCtr.length} priority query opportunities were found.`, items: lowCtr });
  if (striking.length) insights.push({ status: 'info', title: 'Striking-distance queries', detail: `${striking.length} queries rank between positions 4 and 20 and may respond to focused optimisation.`, items: striking });
  if (declining.length) insights.push({ status: 'fail', title: 'Declining queries', detail: `${declining.length} high-priority declines were detected compared with the previous period.`, items: declining });
  if (winners.length) insights.push({ status: 'pass', title: 'Growing queries', detail: `${winners.length} queries gained clicks compared with the previous period.`, items: winners });
  const clickChange = percentChange(summary.clicks, previous.clicks);
  if (clickChange != null) insights.unshift({
    status: clickChange >= 0 ? 'pass' : 'warn',
    title: clickChange >= 0 ? 'Organic clicks increased' : 'Organic clicks decreased',
    detail: `${Math.abs(clickChange).toFixed(1)}% versus the previous equal-length period.`
  });
  if (!pageRows.length) insights.push({ status: 'info', title: 'No page rows returned', detail: 'The selected property and date range returned no page-level rows.' });
  return insights;
}

async function gscReport(property, headers, startDate, endDate) {
  const previousRange = previousDateRange(startDate, endDate);
  const [summaryData, previousSummaryData, dailyData, queriesData, previousQueriesData, pagesData, previousPagesData, countriesData, devicesData, appearancesData] = await Promise.all([
    gscQuery(property, headers, startDate, endDate, [], { rowLimit: 1 }),
    gscQuery(property, headers, previousRange.startDate, previousRange.endDate, [], { rowLimit: 1 }),
    gscQuery(property, headers, startDate, endDate, ['date'], { rowLimit: 500 }),
    gscQuery(property, headers, startDate, endDate, ['query'], { rowLimit: 5000 }),
    gscQuery(property, headers, previousRange.startDate, previousRange.endDate, ['query'], { rowLimit: 5000 }),
    gscQuery(property, headers, startDate, endDate, ['page'], { rowLimit: 3000 }),
    gscQuery(property, headers, previousRange.startDate, previousRange.endDate, ['page'], { rowLimit: 3000 }),
    gscQuery(property, headers, startDate, endDate, ['country'], { rowLimit: 250 }),
    gscQuery(property, headers, startDate, endDate, ['device'], { rowLimit: 20 }),
    gscQuery(property, headers, startDate, endDate, ['searchAppearance'], { rowLimit: 100 })
  ]);

  const summary = gscTotals(summaryData);
  const previous = gscTotals(previousSummaryData);
  const daily = gscRows(dailyData, 'date').sort((a, b) => a.date.localeCompare(b.date));
  const queries = compareRows(gscRows(queriesData, 'query'), gscRows(previousQueriesData, 'query'), 'query');
  const pages = compareRows(gscRows(pagesData, 'page'), gscRows(previousPagesData, 'page'), 'page');
  const countries = gscRows(countriesData, 'country');
  const devices = gscRows(devicesData, 'device');
  const searchAppearance = gscRows(appearancesData, 'searchAppearance');

  return {
    source: 'gsc',
    sourceLabel: 'Google Search Console',
    dataType: 'Verified Google Data',
    property,
    dateRange: { startDate, endDate },
    previousDateRange: previousRange,
    metrics: [
      metric('Clicks', summary.clicks, previous.clicks),
      metric('Impressions', summary.impressions, previous.impressions),
      metric('CTR', summary.ctr, previous.ctr, 'percent'),
      metric('Average position', summary.position, previous.position, 'decimal', 'down')
    ],
    trend: daily,
    breakdowns: {
      queries,
      pages,
      countries,
      devices,
      searchAppearance
    },
    opportunities: {
      lowCtr: queries.filter((row) => row.impressions >= 50 && row.position <= 20 && row.ctr < 0.02).sort((a, b) => b.impressions - a.impressions).slice(0, 50),
      strikingDistance: queries.filter((row) => row.position >= 4 && row.position <= 20).sort((a, b) => b.impressions - a.impressions).slice(0, 50),
      winners: queries.filter((row) => row.clickChange != null && row.clickChange > 20).sort((a, b) => b.clickChange - a.clickChange).slice(0, 50),
      declines: queries.filter((row) => row.clickChange != null && row.clickChange < -20).sort((a, b) => a.clickChange - b.clickChange).slice(0, 50)
    },
    insights: gscInsights(queries, pages, summary, previous),
    notes: [
      'Summary metrics are queried separately from detailed rows to avoid misleading totals from grouped tables.',
      'Search Console data is limited to properties the connected Google account can access.'
    ]
  };
}

async function ga4Run(property, headers, body) {
  return googleFetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(property)}:runReport`,
    { method: 'POST', headers, body },
    35000
  );
}

function ga4Row(row, dimensions, metrics) {
  const output = {};
  dimensions.forEach((name, index) => { output[name] = row.dimensionValues?.[index]?.value || ''; });
  metrics.forEach((name, index) => { output[name] = number(row.metricValues?.[index]?.value); });
  return output;
}

function ga4Rows(data, dimensions, metrics) {
  return (data.rows || []).map((row) => ga4Row(row, dimensions, metrics));
}

async function ga4Summary(property, headers, startDate, endDate) {
  const metrics = ['activeUsers','newUsers','sessions','engagedSessions','engagementRate','screenPageViews','keyEvents','averageSessionDuration'];
  const data = await ga4Run(property, headers, {
    dateRanges: [{ startDate, endDate }],
    metrics: metrics.map((name) => ({ name })),
    limit: 1
  });
  return ga4Rows(data, [], metrics)[0] || Object.fromEntries(metrics.map((name) => [name, 0]));
}

function ga4Insights(summary, previous, channels, landingPages) {
  const insights = [];
  const sessionChange = percentChange(summary.sessions, previous.sessions);
  const userChange = percentChange(summary.activeUsers, previous.activeUsers);
  if (sessionChange != null) insights.push({
    status: sessionChange >= 0 ? 'pass' : 'warn',
    title: sessionChange >= 0 ? 'Sessions increased' : 'Sessions decreased',
    detail: `${Math.abs(sessionChange).toFixed(1)}% versus the previous equal-length period.`
  });
  if (userChange != null) insights.push({
    status: userChange >= 0 ? 'pass' : 'warn',
    title: userChange >= 0 ? 'Active users increased' : 'Active users decreased',
    detail: `${Math.abs(userChange).toFixed(1)}% versus the previous equal-length period.`
  });
  const organic = channels.find((row) => /organic search/i.test(row.sessionDefaultChannelGroup));
  if (organic) insights.push({ status: 'info', title: 'Organic Search contribution', detail: `${organic.sessions.toLocaleString()} sessions in the selected period.` });
  const lowEngagement = landingPages.filter((row) => row.sessions >= 10 && row.engagementRate < 0.4).sort((a, b) => b.sessions - a.sessions).slice(0, 5);
  if (lowEngagement.length) insights.push({ status: 'warn', title: 'High-traffic landing pages with low engagement', detail: `${lowEngagement.length} landing pages need content or journey review.`, items: lowEngagement });
  return insights;
}

async function ga4Report(property, headers, startDate, endDate) {
  const previousRange = previousDateRange(startDate, endDate);
  const summaryMetrics = ['activeUsers','newUsers','sessions','engagedSessions','engagementRate','screenPageViews','keyEvents','averageSessionDuration'];
  const trendMetrics = ['activeUsers','sessions','engagedSessions','screenPageViews','keyEvents'];
  const tableMetrics = ['activeUsers','sessions','engagedSessions','engagementRate','screenPageViews','keyEvents'];

  const [summary, previous, dailyData, channelsData, landingData, countriesData, citiesData, devicesData] = await Promise.all([
    ga4Summary(property, headers, startDate, endDate),
    ga4Summary(property, headers, previousRange.startDate, previousRange.endDate),
    ga4Run(property, headers, { dateRanges: [{ startDate, endDate }], dimensions: [{ name: 'date' }], metrics: trendMetrics.map((name) => ({ name })), orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 500 }),
    ga4Run(property, headers, { dateRanges: [{ startDate, endDate }], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: tableMetrics.map((name) => ({ name })), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 100 }),
    ga4Run(property, headers, { dateRanges: [{ startDate, endDate }], dimensions: [{ name: 'landingPagePlusQueryString' }], metrics: tableMetrics.map((name) => ({ name })), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 1000 }),
    ga4Run(property, headers, { dateRanges: [{ startDate, endDate }], dimensions: [{ name: 'country' }], metrics: tableMetrics.map((name) => ({ name })), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 250 }),
    ga4Run(property, headers, { dateRanges: [{ startDate, endDate }], dimensions: [{ name: 'city' }], metrics: tableMetrics.map((name) => ({ name })), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 250 }),
    ga4Run(property, headers, { dateRanges: [{ startDate, endDate }], dimensions: [{ name: 'deviceCategory' }], metrics: tableMetrics.map((name) => ({ name })), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 20 })
  ]);

  const daily = ga4Rows(dailyData, ['date'], trendMetrics);
  const channels = ga4Rows(channelsData, ['sessionDefaultChannelGroup'], tableMetrics);
  const landingPages = ga4Rows(landingData, ['landingPagePlusQueryString'], tableMetrics);
  const countries = ga4Rows(countriesData, ['country'], tableMetrics);
  const cities = ga4Rows(citiesData, ['city'], tableMetrics);
  const devices = ga4Rows(devicesData, ['deviceCategory'], tableMetrics);

  return {
    source: 'ga4',
    sourceLabel: 'Google Analytics 4',
    dataType: 'Verified Google Data',
    property,
    dateRange: { startDate, endDate },
    previousDateRange: previousRange,
    metrics: [
      metric('Active users', summary.activeUsers, previous.activeUsers),
      metric('New users', summary.newUsers, previous.newUsers),
      metric('Sessions', summary.sessions, previous.sessions),
      metric('Engaged sessions', summary.engagedSessions, previous.engagedSessions),
      metric('Engagement rate', summary.engagementRate, previous.engagementRate, 'percent'),
      metric('Views', summary.screenPageViews, previous.screenPageViews),
      metric('Key events', summary.keyEvents, previous.keyEvents),
      metric('Average session duration', summary.averageSessionDuration, previous.averageSessionDuration, 'duration')
    ],
    trend: daily,
    breakdowns: { channels, landingPages, countries, cities, devices },
    insights: ga4Insights(summary, previous, channels, landingPages),
    notes: [
      'This report uses verified data from the selected GA4 property.',
      'Google Analytics and Search Console use different attribution and processing systems, so totals should not be expected to match.'
    ]
  };
}

module.exports = async function googleReport(req, res) {
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed.' });
  try {
    const body = getBody(req);
    const source = body.source === 'gsc' ? 'gsc' : 'ga4';
    const property = cleanText(body.property);
    const startDate = cleanText(body.startDate);
    const endDate = cleanText(body.endDate);
    if (!property) throw new Error('Select a Google property.');
    validateRange(startDate, endDate);

    const token = await tokens(req, res);
    const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };
    const report = source === 'gsc'
      ? await gscReport(property, headers, startDate, endDate)
      : await ga4Report(property, headers, startDate, endDate);

    return send(res, 200, {
      ...report,
      account: token.account || {},
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
};
