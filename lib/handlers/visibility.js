'use strict';

const { send, cors, page, query, gemini, clampNumber, cleanText } = require('../api-lib');

function normaliseConfidence(value) {
  return String(value || '').toLowerCase() === 'medium' ? 'Medium' : 'Low';
}

module.exports = async function visibility(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const request = query(req);
    const website = await page(request.url);
    const result = await gemini(`Create a transparent AI-based public organic-visibility estimate from the supplied webpage evidence.

Strict accuracy rules:
- Do not claim verified Google rankings, Search Console data, GA4 data, or exact traffic.
- Use only broad ranges and qualitative signals.
- Confidence must be Low or Medium, never High.
- Explicitly state that the estimate is not verified analytics.

URL: ${website.finalUrl}
Target keyword: ${request.keyword || ''}
Country: ${request.country || 'Pakistan'}
City: ${request.city || ''}
HTTP status: ${website.status}
Response time: ${website.ms} ms
Title: ${website.title}
Description: ${website.description}
H1: ${website.h1.join(' | ')}
Visible words: ${website.wordCount}
Detected schema types: ${website.schemaTypes.join(', ')}

Return JSON:
{
  "estimatedTrafficRange":"Unknown|0–100|100–500|500–1K|1K–5K|5K+",
  "visibilityLevel":"",
  "authoritySignal":"",
  "opportunityScore":0-100,
  "confidence":"Low|Medium",
  "signals":[{"status":"info|warn|pass","title":"","detail":""}],
  "recommendations":[{"status":"info|warn|pass","title":"","detail":""}]
}`);

    return send(res, 200, {
      sourceLabel: 'AI Estimated',
      disclaimer:
        'This is an AI-generated visibility estimate based on public webpage signals. It is not verified Google ranking or analytics data.',
      estimatedTrafficRange: cleanText(result.estimatedTrafficRange, 'Unknown'),
      visibilityLevel: cleanText(result.visibilityLevel, 'Not enough public evidence'),
      authoritySignal: cleanText(result.authoritySignal, 'Unverified'),
      opportunityScore: clampNumber(result.opportunityScore, 0, 100, 50),
      confidence: normaliseConfidence(result.confidence),
      signals: Array.isArray(result.signals) ? result.signals.slice(0, 12) : [],
      recommendations: Array.isArray(result.recommendations)
        ? result.recommendations.slice(0, 12)
        : []
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
};
