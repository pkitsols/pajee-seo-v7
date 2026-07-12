'use strict';

const { send } = require('../api-lib');

module.exports = async function health(req, res) {
  return send(res, 200, {
    status: 'ok',
    architecture: {
      serverlessFunctions: 1,
      router: '/api/router.js',
      hobbyPlanCompatible: true
    },
    configured: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      geminiModel: process.env.GEMINI_MODEL || 'automatic fallback',
      pageSpeed: Boolean(process.env.GOOGLE_PAGESPEED_API_KEY),
      crux: Boolean(process.env.GOOGLE_CRUX_API_KEY),
      openPageRank: Boolean(process.env.OPENPAGERANK_API_KEY),
      googleOAuth: Boolean(
        process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET &&
          process.env.SESSION_SECRET
      ),
      email: Boolean(
        process.env.RESEND_API_KEY &&
          process.env.CONTACT_FROM_EMAIL &&
          process.env.CONTACT_TO_EMAIL
      )
    },
    checkedAt: new Date().toISOString()
  });
};
