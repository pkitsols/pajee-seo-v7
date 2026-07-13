'use strict';

const { send, cors, page, query, getBody, gemini, cleanText } = require('../api-lib');

function normaliseItems(items, maximum = 16) {
  return Array.isArray(items)
    ? items.map((item) => ({
        status: ['fail','warn','pass','info'].includes(item?.status) ? item.status : 'info',
        title: cleanText(item?.title),
        detail: cleanText(item?.detail),
        evidence: cleanText(item?.evidence),
        priority: cleanText(item?.priority, 'Medium'),
        effort: cleanText(item?.effort, 'Medium')
      })).filter((item) => item.title || item.detail).slice(0, maximum)
    : [];
}

function normalisePlan(items) {
  return Array.isArray(items)
    ? items.map((item) => ({
        phase: cleanText(item?.phase),
        focus: cleanText(item?.focus),
        tasks: Array.isArray(item?.tasks) ? item.tasks.map((task) => cleanText(task)).filter(Boolean).slice(0, 15) : [],
        outcome: cleanText(item?.outcome),
        kpis: Array.isArray(item?.kpis) ? item.kpis.map((item) => cleanText(item)).filter(Boolean).slice(0, 8) : []
      })).filter((item) => item.phase || item.focus || item.tasks.length).slice(0, 8)
    : [];
}

module.exports = async function aiRoadmap(req, res) {
  if (cors(req, res)) return;
  if (!['GET','POST'].includes(req.method)) return send(res, 405, { message: 'Method not allowed.' });

  try {
    const input = req.method === 'POST' ? getBody(req) : query(req);
    const rawReport = input.report && typeof input.report === 'object' ? JSON.stringify(input.report).slice(0, 70000) : '';
    const website = input.url ? await page(input.url) : null;
    if (!website && !rawReport) throw new Error('Enter a website URL or provide a completed report.');

    const profile = {
      url: website?.finalUrl || cleanText(input.url),
      businessType: cleanText(input.businessType),
      primaryObjective: cleanText(input.primaryObjective),
      primaryConversion: cleanText(input.primaryConversion),
      country: cleanText(input.country, 'Pakistan'),
      city: cleanText(input.city),
      primaryService: cleanText(input.primaryService),
      targetAudience: cleanText(input.targetAudience),
      targetKeyword: cleanText(input.keyword || input.targetKeyword),
      timeline: cleanText(input.timeline),
      limitations: cleanText(input.limitations),
      competitors: cleanText(input.competitors)
    };

    const publicEvidence = website ? {
      status: website.status,
      title: website.title,
      description: website.description,
      h1: website.h1,
      wordCount: website.wordCount,
      schemaTypes: website.schemaTypes,
      canonical: website.canonical,
      viewport: Boolean(website.viewport),
      ogComplete: Boolean(website.og.title && website.og.description && website.og.image)
    } : null;

    const result = await gemini(`Create a practical, evidence-led SEO and digital growth execution roadmap. Return strict JSON.

Accuracy rules:
- Do not invent rankings, traffic, backlink counts, conversions, search volume or business facts.
- Every recommendation must be tied to supplied website evidence, report evidence or an explicitly stated business objective.
- Separate observations from recommendations.
- If data is missing, say what must be measured rather than estimating it as fact.

Business profile: ${JSON.stringify(profile)}
Public webpage evidence: ${JSON.stringify(publicEvidence)}
Completed report evidence: ${rawReport || 'Not supplied'}

Return {
  "executiveSummary":"",
  "confidence":"Low|Medium|High",
  "currentSituation":[{"status":"fail|warn|pass|info","title":"","detail":"","evidence":"","priority":"High|Medium|Low","effort":"High|Medium|Low"}],
  "criticalRisks":[...],
  "quickWins":[...],
  "technicalPriorities":[...],
  "contentPriorities":[...],
  "authorityPriorities":[...],
  "localPriorities":[...],
  "plan":[{"phase":"First 30 days|Days 31–60|Days 61–90","focus":"","tasks":[""],"outcome":"","kpis":[""]}],
  "successKpis":[""],
  "requiredResources":[""],
  "recommendedSupport":""
}`);

    return send(res, 200, {
      sourceLabel: rawReport ? 'AI roadmap from supplied report evidence' : 'AI roadmap from public crawl and supplied business context',
      disclaimer: 'Recommendations are advisory. Verified performance metrics are shown only when supplied through a completed audit, Search Console or GA4 report.',
      profile,
      executiveSummary: cleanText(result.executiveSummary),
      confidence: ['Low','Medium','High'].includes(result.confidence) ? result.confidence : rawReport ? 'High' : 'Medium',
      currentSituation: normaliseItems(result.currentSituation),
      criticalRisks: normaliseItems(result.criticalRisks),
      quickWins: normaliseItems(result.quickWins),
      technicalPriorities: normaliseItems(result.technicalPriorities),
      contentPriorities: normaliseItems(result.contentPriorities),
      authorityPriorities: normaliseItems(result.authorityPriorities),
      localPriorities: normaliseItems(result.localPriorities),
      plan: normalisePlan(result.plan),
      successKpis: Array.isArray(result.successKpis) ? result.successKpis.map(cleanText).filter(Boolean).slice(0, 15) : [],
      requiredResources: Array.isArray(result.requiredResources) ? result.requiredResources.map(cleanText).filter(Boolean).slice(0, 15) : [],
      recommendedSupport: cleanText(result.recommendedSupport)
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
};
