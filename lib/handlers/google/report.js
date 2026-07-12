'use strict';

const { send, getBody, cleanText } = require('../../api-lib');
const { tokens } = require('../../google-auth');

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
}

function validateRange(startDate, endDate) {
  if (!validDate(startDate) || !validDate(endDate)) {
    throw new Error('Choose a valid start and end date.');
  }
  if (Date.parse(startDate) > Date.parse(endDate)) {
    throw new Error('The start date must be before the end date.');
  }
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
    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json'
    };

    if (source === 'gsc') {
      const dimension = ['date', 'query', 'page', 'country', 'device'].includes(body.dimension)
        ? body.dimension
        : 'date';
      const response = await fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
          property
        )}/searchAnalytics/query`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: [dimension],
            rowLimit: 25000,
            dataState: 'final'
          }),
          signal: AbortSignal.timeout(30000)
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || 'Search Console report failed.');
      }

      const rows = data.rows || [];
      const totals = rows.reduce(
        (accumulator, row) => ({
          clicks: accumulator.clicks + Number(row.clicks || 0),
          impressions: accumulator.impressions + Number(row.impressions || 0),
          weightedPosition:
            accumulator.weightedPosition +
            Number(row.position || 0) * Number(row.impressions || 0)
        }),
        { clicks: 0, impressions: 0, weightedPosition: 0 }
      );
      const ctr = totals.impressions ? totals.clicks / totals.impressions : 0;
      const averagePosition = totals.impressions
        ? totals.weightedPosition / totals.impressions
        : 0;

      return send(res, 200, {
        sourceLabel: 'Google Search Console',
        dataType: 'Verified Google Data',
        dateRange: { startDate, endDate },
        metrics: [
          { label: 'Clicks', value: Math.round(totals.clicks).toLocaleString() },
          { label: 'Impressions', value: Math.round(totals.impressions).toLocaleString() },
          { label: 'CTR', value: `${(ctr * 100).toFixed(2)}%` },
          { label: 'Average position', value: averagePosition.toFixed(1) }
        ],
        tableTitle: `Performance by ${dimension}`,
        columns: [dimension, 'Clicks', 'Impressions', 'CTR', 'Position'],
        rows: rows.slice(0, 1000).map((row) => [
          row.keys?.[0] || '',
          Math.round(Number(row.clicks || 0)),
          Math.round(Number(row.impressions || 0)),
          `${(Number(row.ctr || 0) * 100).toFixed(2)}%`,
          Number(row.position || 0).toFixed(1)
        ])
      });
    }

    const dimensionMap = {
      date: 'date',
      query: 'sessionDefaultChannelGroup',
      page: 'landingPagePlusQueryString',
      country: 'country',
      device: 'deviceCategory'
    };
    const dimension = dimensionMap[body.dimension] || 'date';
    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(
        property
      )}:runReport`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: dimension }],
          metrics: [
            { name: 'activeUsers' },
            { name: 'sessions' },
            { name: 'engagedSessions' },
            { name: 'screenPageViews' },
            { name: 'keyEvents' }
          ],
          limit: 1000,
          keepEmptyRows: false
        }),
        signal: AbortSignal.timeout(30000)
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'GA4 report failed.');

    const rows = data.rows || [];
    const sum = (index) =>
      rows.reduce(
        (total, row) => total + Number(row.metricValues?.[index]?.value || 0),
        0
      );
    const sessions = sum(1);
    const engagedSessions = sum(2);

    return send(res, 200, {
      sourceLabel: 'Google Analytics 4',
      dataType: 'Verified Google Data',
      dateRange: { startDate, endDate },
      metrics: [
        { label: 'Active users', value: Math.round(sum(0)).toLocaleString() },
        { label: 'Sessions', value: Math.round(sessions).toLocaleString() },
        { label: 'Engaged sessions', value: Math.round(engagedSessions).toLocaleString() },
        {
          label: 'Engagement rate',
          value: sessions ? `${((engagedSessions / sessions) * 100).toFixed(1)}%` : '0.0%'
        },
        { label: 'Key events', value: Math.round(sum(4)).toLocaleString() }
      ],
      tableTitle: `GA4 performance by ${dimension}`,
      columns: [
        dimension,
        'Active users',
        'Sessions',
        'Engaged sessions',
        'Views',
        'Key events'
      ],
      rows: rows.slice(0, 1000).map((row) => [
        row.dimensionValues?.[0]?.value || '',
        ...(row.metricValues || []).map((value) => value.value)
      ])
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
};
