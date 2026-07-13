'use strict';

const { send, cors, query } = require('../../api-lib');
const { tokens } = require('../../google-auth');
const { propertyMatchScore, normaliseSiteUrl } = require('../../domain-utils');

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      try { output[current] = await worker(items[current], current); }
      catch { output[current] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
  return output.filter(Boolean);
}

module.exports = async function googleStatus(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const token = await tokens(req, res);
    const request = query(req);
    const target = String(request.site || request.url || '').trim();
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
      searchResponse.json().catch(() => ({})),
      analyticsResponse.json().catch(() => ({}))
    ]);

    if (!searchResponse.ok && !analyticsResponse.ok) {
      throw new Error(searchData.error?.message || analyticsData.error?.message || 'Google properties could not be loaded.');
    }

    const gscSites = searchResponse.ok
      ? (searchData.siteEntry || []).map((site) => {
          const score = target ? propertyMatchScore(target, site.siteUrl) : 0;
          return {
            id: site.siteUrl,
            name: site.siteUrl,
            permission: site.permissionLevel || '',
            matchScore: score,
            recommended: score >= 80
          };
        }).sort((a, b) => b.matchScore - a.matchScore || a.name.localeCompare(b.name))
      : [];

    const properties = [];
    if (analyticsResponse.ok) {
      for (const account of analyticsData.accountSummaries || []) {
        for (const property of account.propertySummaries || []) {
          properties.push({
            id: property.property.replace('properties/', ''),
            resource: property.property,
            displayName: property.displayName || property.property,
            accountName: account.displayName || '',
            account: account.account || ''
          });
        }
      }
    }

    const withStreams = await mapLimit(properties.slice(0, 60), 6, async (property) => {
      let streams = [];
      try {
        const response = await fetch(`https://analyticsadmin.googleapis.com/v1beta/${property.resource}/dataStreams?pageSize=50`, {
          headers,
          signal: AbortSignal.timeout(12000)
        });
        const data = await response.json();
        if (response.ok) {
          streams = (data.dataStreams || []).map((stream) => ({
            name: stream.displayName || stream.name,
            type: stream.type || '',
            defaultUri: stream.webStreamData?.defaultUri || '',
            measurementId: stream.webStreamData?.measurementId || ''
          }));
        }
      } catch {
        streams = [];
      }
      let matchScore = 0;
      let matchedUri = '';
      for (const stream of streams) {
        const score = target ? propertyMatchScore(target, stream.defaultUri) : 0;
        if (score > matchScore) {
          matchScore = score;
          matchedUri = stream.defaultUri;
        }
      }
      if (!matchScore && target) {
        const targetHost = normaliseSiteUrl(target).hostname;
        const name = property.displayName.toLowerCase();
        if (targetHost && name.includes(targetHost.split('.')[0])) matchScore = 45;
      }
      return {
        id: property.id,
        name: `${property.displayName} · properties/${property.id}`,
        displayName: property.displayName,
        accountName: property.accountName,
        streams,
        matchedUri,
        matchScore,
        recommended: matchScore >= 70
      };
    });
    withStreams.sort((a, b) => b.matchScore - a.matchScore || a.name.localeCompare(b.name));

    return send(res, 200, {
      connected: true,
      dataType: 'Verified Google account connection',
      account: token.account || {},
      connectedAt: token.connected_at || null,
      targetSite: target || '',
      recommended: {
        gsc: gscSites.find((site) => site.recommended) || null,
        ga4: withStreams.find((property) => property.recommended) || null
      },
      gscSites,
      ga4Properties: withStreams,
      privacy: {
        access: 'Read-only',
        storage: 'Encrypted HttpOnly cookie; tokens are not exposed to page JavaScript.',
        disconnect: 'Disconnect revokes Google access and clears the local session.'
      },
      warnings: [
        !searchResponse.ok ? searchData.error?.message || 'Search Console properties unavailable.' : '',
        !analyticsResponse.ok ? analyticsData.error?.message || 'GA4 properties unavailable.' : '',
        target && !gscSites.some((site) => site.recommended) ? 'No strongly matching Search Console property was found for the supplied website.' : '',
        target && !withStreams.some((property) => property.recommended) ? 'No strongly matching GA4 web stream was found for the supplied website.' : ''
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
