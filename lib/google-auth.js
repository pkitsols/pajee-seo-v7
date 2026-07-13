'use strict';

const { cookie, decrypt, encrypt } = require('./api-lib');

const COOKIE_NAME = '__Host-pajee_google';
const LEGACY_COOKIE_NAME = 'pajee_google';
const MAX_AGE = 365 * 24 * 60 * 60;

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
  return decrypt(cookie(req, COOKIE_NAME)) || decrypt(cookie(req, LEGACY_COOKIE_NAME));
}

function persist(res, token) {
  const value = encrypt({
    ...token,
    last_used_at: Date.now()
  });
  const existing = res.getHeader?.('Set-Cookie');
  const cookies = Array.isArray(existing) ? existing : existing ? [existing] : [];
  cookies.push(sessionCookie(value));
  cookies.push(`${LEGACY_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  res.setHeader('Set-Cookie', cookies);
}

async function tokens(req, res) {
  let token = readSession(req);
  if (!token) throw new Error('Google account is not connected.');

  if (Number(token.expires_at || 0) <= Date.now() + 60000) {
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
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error_description || data.error || 'Google token refresh failed.');
    }
    token = {
      ...token,
      ...data,
      refresh_token: token.refresh_token,
      expires_at: Date.now() + Number(data.expires_in || 3600) * 1000
    };
  }

  persist(res, token);
  return token;
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE,
  sessionCookie,
  clearCookies,
  readSession,
  persist,
  tokens
};
