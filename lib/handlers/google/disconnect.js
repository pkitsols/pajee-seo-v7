'use strict';

const { send, cors } = require('../../api-lib');
const { readSession, clearCookies } = require('../../google-auth');

module.exports = async function googleDisconnect(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed.' });
  const token = readSession(req);
  const revokeToken = token?.refresh_token || token?.access_token;
  if (revokeToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(revokeToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(12000)
      });
    } catch { /* local disconnect still proceeds */ }
  }
  res.setHeader('Set-Cookie', clearCookies());
  return send(res, 200, { disconnected: true, revoked: Boolean(revokeToken) });
};
