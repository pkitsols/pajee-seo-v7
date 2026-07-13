'use strict';

const { send, cors } = require('../../api-lib');
const { readSession, clearCookies } = require('../../google-auth');

module.exports = async function googleDisconnect(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed.' });

  const session = readSession(req);
  const token = session?.refresh_token || session?.access_token;
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(12000)
      });
    } catch {
      // Local session is still removed even if Google revocation is temporarily unavailable.
    }
  }
  res.setHeader('Set-Cookie', clearCookies());
  return send(res, 200, {
    disconnected: true,
    message: 'Google access was disconnected and the local secure session was removed.'
  });
};
