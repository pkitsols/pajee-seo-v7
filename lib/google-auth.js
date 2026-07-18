'use strict';

const { cookie, decrypt, encrypt } = require('./api-lib');

const COOKIE_NAME = '__Host-pajee_google';
const LEGACY_COOKIE_NAME = 'pajee_google';
const MAX_AGE = 60 * 60 * 24 * 365;

function sessionCookie(value, maxAge = MAX_AGE) {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
function clearCookies() {
  return [
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    `${LEGACY_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
  ];
}
function readSession(req) {
  return decrypt(cookie(req, COOKIE_NAME) || cookie(req, LEGACY_COOKIE_NAME));
}
function persist(res, token) {
  res.setHeader('Set-Cookie', sessionCookie(encrypt(token)));
}

async function tokens(req, res) {
  let token = readSession(req);
  if (!token) throw new Error('Google account is not connected.');

  if (token.expires_at <= Date.now() + 60000) {
    if (!token.refresh_token) throw new Error('Google session expired. Reconnect your account.');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: token.refresh_token,
        grant_type: 'refresh_token'
      }),
      signal: AbortSignal.timeout(20000)
    });
    const refreshed = await response.json();
    if (!response.ok) throw new Error(refreshed.error_description || refreshed.error || 'Google token refresh failed.');
    token = {
      ...token,
      ...refreshed,
      refresh_token: token.refresh_token,
      expires_at: Date.now() + (refreshed.expires_in || 3600) * 1000
    };
  }

  // Rolling one-year cookie. Closing the browser does not disconnect the account.
  persist(res, token);
  return token;
}

async function googleUser(token) {
  if (token.user) return token.user;
  try {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok) return null;
    return { email: data.email || '', name: data.name || '', picture: data.picture || '' };
  } catch { return null; }
}

module.exports = { tokens, readSession, persist, sessionCookie, clearCookies, googleUser, COOKIE_NAME, MAX_AGE };
