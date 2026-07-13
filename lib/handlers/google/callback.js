'use strict';

const { verifyState } = require('../../api-lib');
const { persist } = require('../../google-auth');

function requestOrigin(req) {
  const proto = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
  if (!host) throw new Error('The application host could not be determined.');
  return `${proto}://${host}`;
}

function callbackUri(req) {
  const configured = String(process.env.GOOGLE_REDIRECT_URI || '').trim().replace(/\/+$/, '');
  return configured || `${requestOrigin(req)}/api/google/callback`;
}

module.exports = async function googleCallback(req, res) {
  try {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      return res.end('Method not allowed.');
    }
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    if (!req.query.code) throw new Error('Google did not return an authorization code.');
    if (!verifyState(req.query.state)) throw new Error('Invalid or expired OAuth state.');

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUri(req),
        grant_type: 'authorization_code'
      }),
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || 'Token exchange failed.');

    let profile = {};
    try {
      const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` },
        signal: AbortSignal.timeout(12000)
      });
      if (profileResponse.ok) profile = await profileResponse.json();
    } catch {
      profile = {};
    }

    delete data.id_token;
    const token = {
      ...data,
      refresh_token: data.refresh_token || '',
      expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
      connected_at: Date.now(),
      account: {
        email: profile.email || '',
        name: profile.name || '',
        picture: profile.picture || ''
      }
    };
    persist(res, token);
    res.statusCode = 302;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', `${requestOrigin(req)}/reports/google-performance/?google=connected`);
    return res.end();
  } catch (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(`Google connection failed: ${error.message}`);
  }
};
