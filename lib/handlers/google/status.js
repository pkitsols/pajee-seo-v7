'use strict';

const { send, cors, query, rootDomain } = require('../../api-lib');
const { tokens, googleUser } = require('../../google-auth');

function hostFrom(value) {
  try {
    const raw = String(value || '').replace(/^sc-domain:/, 'https://');
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch { return String(value || '').replace(/^sc-domain:/, '').toLowerCase().replace(/^www\./, ''); }
}
function sameSite(target, candidate) {
  if (!target || !candidate) return false;
  const a = hostFrom(target); const b = hostFrom(candidate);
  return a === b || rootDomain(a) === rootDomain(b);
}
async function mapLimit(items, limit, worker) {
  const output = []; let index = 0;
  async function run() {
    while (index < items.length) {
      const current = items[index++];
      try { output.push(await worker(current)); } catch { output.push(null); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output.filter(Boolean);
}

module.exports = async function googleStatus(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });
  try {
    const targetUrl = query(req).url || '';
    const token = await tokens(req, res);
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const [searchResponse, analyticsResponse, user] = await Promise.all([
      fetch('https://www.googleapis.com/webmasters/v3/sites', { headers, signal: AbortSignal.timeout(20000) }),
      fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', { headers, signal: AbortSignal.timeout(20000) }),
      googleUser(token)
    ]);
    const [searchData, analyticsData] = await Promise.all([searchResponse.json(), analyticsResponse.json()]);
    if (!searchResponse.ok && !analyticsResponse.ok) {
      throw new Error(searchData.error?.message || analyticsData.error?.message || 'Google properties could not be loaded.');
    }

    const gscSites = searchResponse.ok
      ? (searchData.siteEntry || []).map((site) => ({
          id: site.siteUrl,
          name: site.siteUrl,
          permission: site.permissionLevel || '',
          recommended: sameSite(targetUrl, site.siteUrl)
        })).sort((a, b) => Number(b.recommended) - Number(a.recommended))
      : [];

    const rawProperties = [];
    if (analyticsResponse.ok) {
      for (const account of analyticsData.accountSummaries || []) {
        for (const property of account.propertySummaries || []) {
          rawProperties.push({
            id: property.property.replace('properties/', ''),
            resource: property.property,
            name: `${property.displayName} · ${property.property}`,
            account: account.displayName || ''
          });
        }
      }
    }

    const ga4Properties = await mapLimit(rawProperties.slice(0, 60), 6, async (property) => {
      let urls = [];
      try {
        const response = await fetch(`https://analyticsadmin.googleapis.com/v1beta/${property.resource}/dataStreams?pageSize=50`, {
          headers, signal: AbortSignal.timeout(12000)
        });
        const data = await response.json();
        if (response.ok) {
          urls = (data.dataStreams || [])
            .filter((stream) => stream.type === 'WEB_DATA_STREAM')
            .map((stream) => stream.webStreamData?.defaultUri || '')
            .filter(Boolean);
        }
      } catch { /* matching remains unavailable */ }
      return { ...property, urls, recommended: urls.some((url) => sameSite(targetUrl, url)) };
    });
    ga4Properties.sort((a, b) => Number(b.recommended) - Number(a.recommended));

    return send(res, 200, {
      connected: true,
      dataType: 'Verified Google account connection',
      user,
      targetUrl,
      gscSites,
      ga4Properties,
      recommended: {
        gsc: gscSites.find((item) => item.recommended)?.id || '',
        ga4: ga4Properties.find((item) => item.recommended)?.id || ''
      },
      warnings: [
        !searchResponse.ok ? searchData.error?.message || 'Search Console properties unavailable.' : '',
        !analyticsResponse.ok ? analyticsData.error?.message || 'GA4 properties unavailable.' : ''
      ].filter(Boolean)
    });
  } catch (error) {
    return send(res, 200, { connected: false, message: error.message, gscSites: [], ga4Properties: [] });
  }
};
