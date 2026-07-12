'use strict';

const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/pajeeseo\.pk$/i,
  /^https:\/\/www\.pajeeseo\.pk$/i,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
  /^http:\/\/localhost(?::\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i
];

function send(res, status, data) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(data));
}

function cors(req, res) {
  const origin = String(req.headers?.origin || '');
  if (origin && ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function privateIp(ip) {
  if (net.isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
      parts[0] >= 224
    );
  }
  if (net.isIP(ip) === 6) {
    const value = ip.toLowerCase();
    return (
      value === '::1' ||
      value === '::' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe80:') ||
      value.startsWith('::ffff:127.') ||
      value.startsWith('::ffff:10.') ||
      value.startsWith('::ffff:192.168.')
    );
  }
  return true;
}

async function publicUrl(input) {
  let value = String(input || '').trim();
  if (!value) throw new Error('Enter a website URL.');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Enter a public HTTP or HTTPS website URL.');
  }
  if (url.username || url.password) {
    throw new Error('URLs containing login credentials are not allowed.');
  }
  if (['localhost', '0.0.0.0'].includes(url.hostname.toLowerCase())) {
    throw new Error('Private or local network URLs are not allowed.');
  }

  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => privateIp(entry.address))) {
    throw new Error('Private or local network URLs are not allowed.');
  }
  return url.toString();
}

function strip(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag = '', name) {
  const quoted = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  if (quoted) return quoted[1];
  const unquoted = tag.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, 'i'));
  return unquoted ? unquoted[1] : '';
}

function meta(html, key, value) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find((item) => attr(item, key).toLowerCase() === String(value).toLowerCase());
  return tag ? attr(tag, 'content') : '';
}

function linkRel(html, rel) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  const tag = tags.find((item) => attr(item, 'rel').toLowerCase().split(/\s+/).includes(rel));
  return tag ? attr(tag, 'href') : '';
}

function absolutise(value, base) {
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

function jsonLd(html) {
  const output = [];
  const pattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html)) && output.length < 50) {
    const raw = match[1].trim();
    try {
      output.push({ valid: true, data: JSON.parse(raw) });
    } catch (error) {
      output.push({ valid: false, error: error.message, raw: raw.slice(0, 1200) });
    }
  }
  return output;
}

function types(value, set = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => types(item, set));
  } else if (value && typeof value === 'object') {
    const type = value['@type'];
    if (Array.isArray(type)) type.forEach((item) => set.add(String(item)));
    else if (type) set.add(String(type));
    Object.values(value).forEach((item) => types(item, set));
  }
  return [...set];
}

async function fetchPublicResponse(input, options = {}) {
  let current = await publicUrl(input);
  const redirects = Math.min(8, Math.max(0, Number(options.redirects ?? 5)));

  for (let index = 0; index <= redirects; index += 1) {
    const response = await fetch(current, {
      ...options,
      redirect: 'manual',
      headers: {
        'user-agent': 'PajeeSEO-ToolBot/3.0 (+https://pajeeseo.pk)',
        accept: options.accept || 'text/html,application/xhtml+xml,text/plain,application/xml',
        ...(options.headers || {})
      }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return { response, finalUrl: current };
      current = await publicUrl(new URL(location, current).toString());
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error('Too many redirects were returned by the website.');
}

async function fetchText(
  input,
  {
    timeout = 10000,
    max = 2500000,
    accept = 'text/html,application/xhtml+xml,text/plain,application/xml',
    method = 'GET',
    headers = {},
    redirects = 5
  } = {}
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = Date.now();
  let result;

  try {
    result = await fetchPublicResponse(input, {
      method,
      headers,
      accept,
      redirects,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  const { response, finalUrl } = result;
  if (method === 'HEAD') {
    return { response, text: '', ms: Date.now() - started, finalUrl };
  }

  const reader = response.body?.getReader();
  if (!reader) return { response, text: '', ms: Date.now() - started, finalUrl };

  let total = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return {
    response,
    text: new TextDecoder().decode(merged),
    ms: Date.now() - started,
    finalUrl
  };
}

async function page(input) {
  const requestedUrl = await publicUrl(input);
  const fetched = await fetchText(requestedUrl);
  const response = fetched.response;
  const html = fetched.text;
  const finalUrl = fetched.finalUrl || response.url || requestedUrl;
  const contentType = response.headers.get('content-type') || '';

  if (response.ok && contentType && !/(text\/html|application\/xhtml\+xml)/i.test(contentType)) {
    throw new Error(`The URL returned ${contentType}, not an HTML webpage.`);
  }

  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((match) => strip(match[1]))
    .filter(Boolean);
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) => ({
    level: Number(match[1]),
    text: strip(match[2])
  }));
  const images = (html.match(/<img\b[^>]*>/gi) || [])
    .map((tag) => ({
      src: absolutise(attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src'), finalUrl),
      alt: attr(tag, 'alt'),
      hasAlt: /\salt(?:\s*=|\s|>)/i.test(tag),
      tag
    }))
    .filter((image) => image.src);
  const links = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [])
    .map((tag) => ({
      url: absolutise(attr(tag, 'href'), finalUrl),
      anchor: strip(tag)
    }))
    .filter((link) => link.url && /^https?:/i.test(link.url));
  const blocks = jsonLd(html);

  return {
    requestedUrl,
    finalUrl,
    status: response.status,
    ok: response.ok,
    ms: fetched.ms,
    contentType,
    html,
    title: strip((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ''),
    description: meta(html, 'name', 'description'),
    robots: meta(html, 'name', 'robots'),
    xRobotsTag: response.headers.get('x-robots-tag') || '',
    viewport: meta(html, 'name', 'viewport'),
    canonical: absolutise(linkRel(html, 'canonical'), finalUrl),
    lang: attr((html.match(/<html\b[^>]*>/i) || [])[0] || '', 'lang'),
    h1,
    headings,
    images,
    links,
    blocks,
    schemaTypes: types(blocks.filter((block) => block.valid).map((block) => block.data)),
    og: {
      title: meta(html, 'property', 'og:title'),
      description: meta(html, 'property', 'og:description'),
      image: absolutise(meta(html, 'property', 'og:image'), finalUrl),
      url: absolutise(meta(html, 'property', 'og:url'), finalUrl),
      type: meta(html, 'property', 'og:type')
    },
    twitter: {
      card: meta(html, 'name', 'twitter:card'),
      title: meta(html, 'name', 'twitter:title'),
      description: meta(html, 'name', 'twitter:description'),
      image: absolutise(meta(html, 'name', 'twitter:image'), finalUrl)
    },
    wordCount: strip(html).split(/\s+/).filter(Boolean).length
  };
}

function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body || '{}');
  } catch {
    return {};
  }
}

function query(req) {
  return req.query || Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
}

function clampNumber(value, min = 0, max = 100, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function cleanText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

async function gemini(prompt, { json = true } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured in Vercel.');

  const models = [
    process.env.GEMINI_MODEL,
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-2.5-flash'
  ]
    .filter(Boolean)
    .filter((model, index, list) => list.indexOf(model) === index);

  let lastError = 'Gemini request failed.';
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 6000
      }
    };
    if (json) body.generationConfig.responseMimeType = 'application/json';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      const data = await response.json();
      if (!response.ok) {
        lastError = data.error?.message || lastError;
        continue;
      }
      const text = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
      if (!json) return text;
      try {
        return JSON.parse(text);
      } catch {
        const objectMatch = text.match(/\{[\s\S]*\}/);
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (objectMatch) return JSON.parse(objectMatch[0]);
        if (arrayMatch) return JSON.parse(arrayMatch[0]);
        lastError = 'AI returned an unreadable response.';
      }
    } catch (error) {
      lastError = error.name === 'AbortError' ? 'The AI request timed out.' : error.message;
    }
  }
  throw new Error(lastError);
}

function cookie(req, name) {
  const source = req.headers?.cookie || '';
  const match = source.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

function key32(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(object) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key32(secret), iv);
  const encoded = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(object))), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encoded]).toString('base64url');
}

function decrypt(value) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !value) return null;
  try {
    const buffer = Buffer.from(value, 'base64url');
    if (buffer.length < 29) return null;
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encoded = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key32(secret), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encoded), decipher.final()]).toString());
  } catch {
    return null;
  }
}

function stateToken() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured.');
  const timestamp = Date.now().toString();
  const signature = crypto.createHmac('sha256', secret).update(timestamp).digest('base64url');
  return `${timestamp}.${signature}`;
}

function verifyState(value) {
  const [timestamp, signature] = String(value || '').split('.');
  if (!timestamp || !signature || Date.now() - Number(timestamp) > 10 * 60 * 1000) return false;
  const expected = crypto
    .createHmac('sha256', process.env.SESSION_SECRET || '')
    .update(timestamp)
    .digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = {
  send,
  cors,
  publicUrl,
  fetchText,
  fetchPublicResponse,
  page,
  strip,
  attr,
  meta,
  linkRel,
  absolutise,
  jsonLd,
  types,
  getBody,
  query,
  gemini,
  cookie,
  encrypt,
  decrypt,
  stateToken,
  verifyState,
  clampNumber,
  cleanText
};
