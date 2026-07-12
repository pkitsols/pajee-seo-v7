'use strict';

const { send } = require('../lib/api-lib');

const handlers = Object.freeze({
  health: require('../lib/handlers/health'),
  pagespeed: require('../lib/handlers/pagespeed'),
  'keyword-intelligence': require('../lib/handlers/keyword-intelligence'),
  'site-audit': require('../lib/handlers/site-audit'),
  visibility: require('../lib/handlers/visibility'),
  'traffic-estimate': require('../lib/handlers/traffic-estimate'),
  'ai-roadmap': require('../lib/handlers/ai-roadmap'),
  'ai-summary': require('../lib/handlers/ai-summary'),
  'schema-intelligence': require('../lib/handlers/schema-intelligence'),
  contact: require('../lib/handlers/contact'),
  'google-auth': require('../lib/handlers/google/auth'),
  'google-callback': require('../lib/handlers/google/callback'),
  'google-status': require('../lib/handlers/google/status'),
  'google-report': require('../lib/handlers/google/report'),
  'google-disconnect': require('../lib/handlers/google/disconnect')
});

const buckets = globalThis.__PAJEE_RATE_LIMITS__ || new Map();
globalThis.__PAJEE_RATE_LIMITS__ = buckets;

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function rateLimit(req, action) {
  if (action === 'health' || action === 'google-callback' || action === 'google-auth') return null;

  const expensive = new Set([
    'pagespeed',
    'keyword-intelligence',
    'site-audit',
    'visibility',
    'traffic-estimate',
    'ai-roadmap',
    'ai-summary',
    'schema-intelligence'
  ]);
  const windowMs = action === 'contact' ? 10 * 60 * 1000 : 60 * 1000;
  const maximum = action === 'contact' ? 5 : expensive.has(action) ? 20 : 60;
  const now = Date.now();
  const key = `${clientIp(req)}:${action}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  current.count += 1;
  if (current.count > maximum) {
    return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  }
  return null;
}

module.exports = async function router(req, res) {
  const queryAction = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
  const action = String(queryAction || '').trim();
  const handler = handlers[action];

  if (!handler) {
    return send(res, 404, {
      message: 'Unknown API action.',
      available: Object.keys(handlers)
    });
  }

  const retryAfter = rateLimit(req, action);
  if (retryAfter) {
    res.setHeader('Retry-After', String(retryAfter));
    return send(res, 429, {
      message: `Too many ${action} requests. Try again in ${retryAfter} seconds.`
    });
  }

  try {
    return await handler(req, res);
  } catch (error) {
    console.error('Pajee SEO API router error:', action, error);
    if (!res.headersSent && !res.writableEnded) {
      return send(res, 500, { message: 'The server could not complete this request.' });
    }
  }
};
