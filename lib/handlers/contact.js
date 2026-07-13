'use strict';

const crypto = require('crypto');
const { send, cors, getBody, cleanText } = require('../api-lib');

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
}

function limit(value, maximum) {
  return cleanText(value).slice(0, maximum);
}

module.exports = async function contact(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const body = getBody(req);
    const name = limit(body.name, 120);
    const email = limit(body.email, 254);
    const company = limit(body.company, 160);
    const website = limit(body.website, 500);
    const service = limit(body.service, 160);
    const message = limit(body.message, 5000);

    if (!name || !email || !message) {
      throw new Error('Name, email, and message are required.');
    }
    if (!validEmail(email)) throw new Error('Enter a valid email address.');
    if (name.length < 2 || message.length < 10) {
      throw new Error('Please provide a little more detail so the team can help properly.');
    }
    if (!process.env.RESEND_API_KEY) {
      throw new Error('Email service is not configured.');
    }

    const from = process.env.CONTACT_FROM_EMAIL || 'Pajee SEO <onboarding@resend.dev>';
    const to = process.env.CONTACT_TO_EMAIL || 'pkitsol@gmail.com';
    const payload = {
      from,
      to: [to],
      reply_to: email,
      subject: `New Pajee SEO enquiry from ${name}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Company: ${company}`,
        `Website: ${website}`,
        `Service: ${service}`,
        '',
        message
      ].join('\n')
    };

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto
          .createHash('sha256')
          .update(`${email}|${message}|${Math.floor(Date.now() / 60000)}`)
          .digest('hex')
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Email could not be sent.');

    return send(res, 200, {
      message: 'Thank you. Your enquiry has been sent to Pajee SEO.',
      reference: data.id || null
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
};
