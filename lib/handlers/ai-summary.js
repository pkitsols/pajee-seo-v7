'use strict';

const { send, cors, getBody, gemini, cleanText } = require('../api-lib');

function items(value, maximum = 12) {
  return Array.isArray(value)
    ? value
        .map((item) => ({
          status: ['fail', 'warn', 'pass', 'info'].includes(item?.status)
            ? item.status
            : 'info',
          title: cleanText(item?.title),
          detail: cleanText(item?.detail)
        }))
        .filter((item) => item.title || item.detail)
        .slice(0, maximum)
    : [];
}

module.exports = async function aiSummary(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const body = getBody(req);
    const raw = JSON.stringify(body.report || {}).slice(0, 60000);
    const result = await gemini(`Summarise the supplied SEO report into strict JSON.

Accuracy rules:
- Do not add metrics or findings that are absent from the report.
- Do not invent rankings, traffic, backlinks, conversions, or search volume.
- Confidence must be Low or Medium.

URL: ${body.url || ''}
Keyword: ${body.keyword || ''}
Report: ${raw}

Return {"confidence":"Low|Medium","critical":[{"status":"fail","title":"","detail":""}],"quickWins":[{"status":"warn","title":"","detail":""}],"content":[{"status":"info","title":"","detail":""}],"plan":[{"phase":"","focus":"","tasks":[""],"outcome":""}]}.`);

    const plan = Array.isArray(result.plan)
      ? result.plan
          .map((item) => ({
            phase: cleanText(item?.phase),
            focus: cleanText(item?.focus),
            tasks: Array.isArray(item?.tasks)
              ? item.tasks.map((task) => cleanText(task)).filter(Boolean).slice(0, 12)
              : [],
            outcome: cleanText(item?.outcome)
          }))
          .filter((item) => item.phase || item.focus || item.tasks.length)
          .slice(0, 8)
      : [];

    return send(res, 200, {
      sourceLabel: 'AI summary of supplied report evidence',
      confidence: String(result.confidence).toLowerCase() === 'medium' ? 'Medium' : 'Low',
      critical: items(result.critical),
      quickWins: items(result.quickWins),
      content: items(result.content),
      plan
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
};
