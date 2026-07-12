'use strict';

const { send, cors } = require('../../api-lib');
const { tokens } = require('../../google-auth');

module.exports = async function googleStatus(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const token = await tokens(req, res);
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const [searchResponse, analyticsResponse] = await Promise.all([
      fetch('https://www.googleapis.com/webmasters/v3/sites', {
        headers,
        signal: AbortSignal.timeout(20000)
      }),
      fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
        headers,
        signal: AbortSignal.timeout(20000)
      })
    ]);
    const [searchData, analyticsData] = await Promise.all([
      searchResponse.json(),
      analyticsResponse.json()
    ]);

    if (!searchResponse.ok && !analyticsResponse.ok) {
      throw new Error(
        searchData.error?.message ||
          analyticsData.error?.message ||
          'Google properties could not be loaded.'
      );
    }

    const gscSites = searchResponse.ok
      ? (searchData.siteEntry || []).map((site) => ({ id: site.siteUrl, name: site.siteUrl }))
      : [];
    const ga4Properties = [];
    if (analyticsResponse.ok) {
      for (const account of analyticsData.accountSummaries || []) {
        for (const property of account.propertySummaries || []) {
          ga4Properties.push({
            id: property.property.replace('properties/', ''),
            name: `${property.displayName} · ${property.property}`
          });
        }
      }
    }

    return send(res, 200, {
      connected: true,
      dataType: 'Verified Google account connection',
      gscSites,
      ga4Properties,
      warnings: [
        !searchResponse.ok ? searchData.error?.message || 'Search Console properties unavailable.' : '',
        !analyticsResponse.ok ? analyticsData.error?.message || 'GA4 properties unavailable.' : ''
      ].filter(Boolean)
    });
  } catch (error) {
    return send(res, 200, {
      connected: false,
      message: error.message,
      gscSites: [],
      ga4Properties: []
    });
  }
};
