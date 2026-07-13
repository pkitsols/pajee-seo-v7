'use strict';

const { send, cors, page, query, gemini, cleanText } = require('../api-lib');

function confidence(value) {
  return String(value || '').toLowerCase() === 'medium' ? 'Medium' : 'Low';
}

module.exports = async function trafficEstimate(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const request = query(req);
    const website = await page(request.url);
    const result = await gemini(`Estimate only a broad public website-visibility range with maximum transparency.

Accuracy rules:
- You cannot see GA4, server logs, Search Console, paid-media accounts, or direct traffic.
- Never produce a precise number.
- Use one of these broad ranges only: Unknown, 0–100, 100–500, 500–1K, 1K–5K, 5K+.
- Organic share must also be a broad range or Unknown.
- Confidence must be Low or Medium.
- Include a signal explaining that the result is AI-estimated and not verified analytics.

Website: ${website.finalUrl}
Country: ${request.country || 'Pakistan'}
HTTP status: ${website.status}
Title: ${website.title}
Visible words: ${website.wordCount}
H1: ${website.h1.join(' | ')}
Schema types: ${website.schemaTypes.join(', ')}
Response time: ${website.ms} ms

Return JSON:
{
  "monthlyRange":"Unknown|0–100|100–500|500–1K|1K–5K|5K+",
  "organicShare":"Unknown|0–25%|25–50%|50–75%|75%+",
  "visibilityLevel":"",
  "confidence":"Low|Medium",
  "signals":[{"status":"info|warn|pass","title":"","detail":""}],
  "recommendations":[{"status":"info|warn|pass","title":"","detail":""}]
}`);

    const signals = Array.isArray(result.signals) ? result.signals.slice(0, 12) : [];
    if (!signals.some((item) => /AI|estimate|verified/i.test(`${item?.title} ${item?.detail}`))) {
      signals.unshift({
        status: 'info',
        title: 'AI-estimated range',
        detail:
          'This result is inferred from public webpage signals and does not represent verified analytics traffic.'
      });
    }

    return send(res, 200, {
      sourceLabel: 'AI Estimated',
      disclaimer:
        'This broad range is not official analytics data. Connect GA4 or Google Search Console for verified owned-property performance.',
      monthlyRange: cleanText(result.monthlyRange, 'Unknown'),
      organicShare: cleanText(result.organicShare, 'Unknown'),
      visibilityLevel: cleanText(result.visibilityLevel, 'Not enough public evidence'),
      confidence: confidence(result.confidence),
      signals,
      recommendations: Array.isArray(result.recommendations)
        ? result.recommendations.slice(0, 12)
        : []
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
};
