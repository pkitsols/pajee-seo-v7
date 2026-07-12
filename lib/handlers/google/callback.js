'use strict';

const { verifyState, encrypt } = require('../../api-lib');

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
    if (!response.ok) {
      throw new Error(data.error_description || data.error || 'Token exchange failed.');
    }
    delete data.id_token;
    data.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
    res.setHeader(
      'Set-Cookie',
      `pajee_google=${encodeURIComponent(
        encrypt(data)
      )}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`
    );
    res.statusCode = 302;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', `${requestOrigin(req)}/dashboard/`);
    return res.end();
  } catch (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(`Google connection failed: ${error.message}`);
  }
};
