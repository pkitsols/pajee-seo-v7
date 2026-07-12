'use strict';

const { stateToken } = require('../../api-lib');

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

module.exports = async function googleAuth(req, res) {
  try {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      return res.end('Method not allowed.');
    }
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET || !process.env.SESSION_SECRET) {
      throw new Error('Google OAuth environment variables are not configured.');
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUri(req),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope:
        'openid email https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly',
      state: stateToken()
    });
    res.statusCode = 302;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    return res.end();
  } catch (error) {
    res.statusCode = 500;
    return res.end(error.message);
  }
};
