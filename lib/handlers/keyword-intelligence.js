'use strict';

const { send, cors, page, query, gemini, clampNumber, cleanText } = require('../api-lib');

const DEMAND_RANGES = ['0–50', '50–100', '100–500', '500–1K', '1K–5K', '5K+'];
const DEMAND_SIGNALS = ['Low', 'Medium', 'High'];
const COMPETITION = ['Low', 'Medium', 'High'];

function normaliseRange(value) {
  const text = String(value || '').replace(/-/g, '–').replace(/\s+/g, '');
  const found = DEMAND_RANGES.find((range) => range.replace(/\s+/g, '') === text);
  return found || 'Unknown';
}

function normaliseLevel(value, allowed, fallback) {
  const text = cleanText(value);
  return allowed.find((item) => item.toLowerCase() === text.toLowerCase()) || fallback;
}

module.exports = async function keywordIntelligence(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const request = query(req);
    const website = await page(request.url);
    const keyword = cleanText(request.keyword);
    if (!keyword) throw new Error('Enter a target keyword or topic.');

    const country = cleanText(request.country, 'Pakistan') || 'Pakistan';
    const city = cleanText(request.city);
    const excerpt = website.html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 7000);

    const result = await gemini(`You are an SEO keyword strategist. Analyse the supplied webpage and seed keyword. Return strict JSON only.

Accuracy policy:
- You do not have Google Ads keyword volume.
- Demand values are AI estimates, not official search-volume data.
- Use only these broad demand ranges: 0–50, 50–100, 100–500, 500–1K, 1K–5K, 5K+.
- Do not invent CPC, exact volume, exact rank, or proprietary keyword-difficulty scores.
- Confidence cannot be High because no official keyword-volume source is connected.

URL: ${website.finalUrl}
Title: ${website.title}
Description: ${website.description}
H1: ${website.h1.join(' | ')}
Page text excerpt: ${excerpt}
Target keyword: ${keyword}
Country: ${country}
City: ${city}

Return this shape:
{
  "primaryIntent": "Informational|Commercial|Transactional|Navigational|Local commercial|Mixed",
  "opportunityScore": 0-100,
  "demandSignal": "Low|Medium|High",
  "confidence": "Low|Medium",
  "keywords": [{"keyword":"","intent":"","demandRange":"100–500","competition":"Low|Medium|High","opportunity":0-100}],
  "entities": [""],
  "recommendedPages": [{"title":"","path":"/suggested-slug/"}],
  "contentOutline": [""]
}`);

    const keywords = Array.isArray(result.keywords)
      ? result.keywords
          .filter((item) => cleanText(item?.keyword))
          .slice(0, 40)
          .map((item) => ({
            keyword: cleanText(item.keyword),
            intent: cleanText(item.intent, 'Mixed'),
            demandRange: normaliseRange(item.demandRange),
            competition: normaliseLevel(item.competition, COMPETITION, 'Medium'),
            opportunity: clampNumber(item.opportunity, 0, 100, 50)
          }))
      : [];

    if (!keywords.length) {
      keywords.push({
        keyword,
        intent: cleanText(result.primaryIntent, 'Mixed'),
        demandRange: 'Unknown',
        competition: 'Medium',
        opportunity: clampNumber(result.opportunityScore, 0, 100, 50)
      });
    }

    return send(res, 200, {
      sourceLabel: 'AI Estimated',
      disclaimer:
        'Demand ranges and competition signals are AI estimates, not official Google Ads data. Connect Google Search Console for verified owned-site query data.',
      primaryIntent: cleanText(result.primaryIntent, 'Mixed'),
      opportunityScore: clampNumber(result.opportunityScore, 0, 100, 50),
      demandSignal: normaliseLevel(result.demandSignal, DEMAND_SIGNALS, 'Medium'),
      confidence: normaliseLevel(result.confidence, ['Low', 'Medium'], 'Low'),
      keywords,
      entities: Array.isArray(result.entities)
        ? result.entities.map((item) => cleanText(item)).filter(Boolean).slice(0, 30)
        : [],
      recommendedPages: Array.isArray(result.recommendedPages)
        ? result.recommendedPages
            .map((item) => ({
              title: cleanText(item?.title),
              path: cleanText(item?.path)
            }))
            .filter((item) => item.title || item.path)
            .slice(0, 15)
        : [],
      contentOutline: Array.isArray(result.contentOutline)
        ? result.contentOutline.map((item) => cleanText(item)).filter(Boolean).slice(0, 30)
        : []
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
};
