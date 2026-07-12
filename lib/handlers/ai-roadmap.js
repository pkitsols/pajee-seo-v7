'use strict';

const { send, cors, page, query, gemini, cleanText } = require('../api-lib');

function normaliseItems(items, maximum = 12) {
  return Array.isArray(items)
    ? items
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

function normalisePlan(items) {
  return Array.isArray(items)
    ? items
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
}

module.exports = async function aiRoadmap(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const request = query(req);
    const website = await page(request.url);
    const result = await gemini(`Create a practical SEO execution roadmap using only the supplied public webpage evidence.

Rules:
- Separate observed facts from recommendations.
- Do not invent rankings, traffic, backlink counts, conversions, or search volume.
- Confidence must be Low or Medium because this is based on a public crawl sample.

URL: ${website.finalUrl}
Target keyword: ${request.keyword || ''}
Country: ${request.country || 'Pakistan'}
City: ${request.city || ''}
HTTP status: ${website.status}
Title: ${website.title}
Description: ${website.description}
H1: ${website.h1.join(' | ')}
Visible words: ${website.wordCount}
Schema: ${website.schemaTypes.join(', ')}
Canonical: ${website.canonical}
Viewport: ${website.viewport}
OG title: ${website.og.title}

Return JSON:
{
  "confidence":"Low|Medium",
  "critical":[{"status":"fail","title":"","detail":""}],
  "quickWins":[{"status":"warn","title":"","detail":""}],
  "content":[{"status":"info","title":"","detail":""}],
  "plan":[{"phase":"","focus":"","tasks":[""],"outcome":""}]
}`);

    return send(res, 200, {
      sourceLabel: 'AI recommendations from public crawl evidence',
      disclaimer: 'This roadmap is advisory and does not claim verified rankings or analytics data.',
      confidence: String(result.confidence).toLowerCase() === 'medium' ? 'Medium' : 'Low',
      critical: normaliseItems(result.critical),
      quickWins: normaliseItems(result.quickWins),
      content: normaliseItems(result.content),
      plan: normalisePlan(result.plan)
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
};
