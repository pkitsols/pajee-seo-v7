'use strict';

const { send, cors } = require('../../api-lib');

module.exports = async function googleDisconnect(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed.' });
  res.setHeader(
    'Set-Cookie',
    'pajee_google=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'
  );
  return send(res, 200, { disconnected: true });
};
