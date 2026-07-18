'use strict';

const { send, cors, page, query, getBody, gemini, cleanText } = require('../api-lib');

function items(value, max = 12) {
  return Array.isArray(value) ? value.map((item)=>({title:cleanText(item?.title),detail:cleanText(item?.detail),priority:cleanText(item?.priority,'Medium'),evidence:cleanText(item?.evidence),action:cleanText(item?.action)})).filter((i)=>i.title||i.detail).slice(0,max) : [];
}
function phases(value) {
  return Array.isArray(value) ? value.map((item)=>({period:cleanText(item?.period),objective:cleanText(item?.objective),tasks:Array.isArray(item?.tasks)?item.tasks.map(cleanText).filter(Boolean).slice(0,12):[],kpis:Array.isArray(item?.kpis)?item.kpis.map(cleanText).filter(Boolean).slice(0,8):[],outcome:cleanText(item?.outcome)})).filter((i)=>i.period||i.objective||i.tasks.length).slice(0,6) : [];
}
async function competitorEvidence(urls) {
  const list = Array.isArray(urls) ? urls : String(urls || '').split(/[\n,]/);
  const cleaned = list.map((v)=>v.trim()).filter(Boolean).slice(0,3);
  const results = [];
  for (const url of cleaned) {
    try { const p=await page(url); results.push({url:p.finalUrl,title:p.title,h1:p.h1,description:p.description,wordCount:p.wordCount,schemaTypes:p.schemaTypes,excerpt:p.textExcerpt.slice(0,3500)}); }
    catch(error){ results.push({url,error:error.message}); }
  }
  return results;
}

module.exports = async function aiRoadmap(req,res) {
  if (cors(req,res)) return;
  if (!['GET','POST'].includes(req.method)) return send(res,405,{message:'Method not allowed.'});
  try {
    const input = req.method==='POST' ? getBody(req) : query(req);
    const website = await page(input.url);
    const competitors = await competitorEvidence(input.competitors);
    const business = {
      goal:cleanText(input.goal||input.businessGoal), conversion:cleanText(input.conversion), audience:cleanText(input.audience),
      service:cleanText(input.service||input.primaryService), country:cleanText(input.country,'Pakistan')||'Pakistan', city:cleanText(input.city),
      timeline:cleanText(input.timeline,'90 days'), constraints:cleanText(input.constraints), keyword:cleanText(input.keyword)
    };
    const result = await gemini(`Build a practical website-specific SEO and digital growth execution roadmap from public evidence and the user's business context.

Accuracy rules:
- Distinguish observed webpage facts, competitor observations, assumptions and recommendations.
- Never invent traffic, rankings, conversions, backlink counts, CPC, search volume or revenue.
- Use plain language suitable for a business owner.
- Recommend tasks that are specific to the supplied website, niche, goal and conversion.
- Confidence must be Low or Medium unless a point is directly observed in the crawled page.

WEBSITE
URL: ${website.finalUrl}
Site name: ${website.siteName}
Title: ${website.title}
Description: ${website.description}
H1: ${website.h1.join(' | ')}
Words: ${website.wordCount}
Schema: ${website.schemaTypes.join(', ')}
Canonical: ${website.canonical}
Page excerpt: ${website.textExcerpt.slice(0,8000)}

BUSINESS CONTEXT
${JSON.stringify(business)}

COMPETITOR PUBLIC EVIDENCE
${JSON.stringify(competitors).slice(0,16000)}

Return strict JSON:
{
 "confidence":"Low|Medium",
 "businessSummary":"",
 "marketContext":"",
 "observations":[{"title":"","detail":"","priority":"High|Medium|Low","evidence":"","action":""}],
 "competitorPatterns":[{"title":"","detail":"","priority":"High|Medium|Low","evidence":"","action":""}],
 "technicalPriorities":[...],
 "contentPriorities":[...],
 "authorityPriorities":[...],
 "conversionPriorities":[...],
 "roadmap":[{"period":"Days 1–30","objective":"","tasks":[""],"kpis":[""],"outcome":""}],
 "measurementPlan":[{"title":"","detail":"","priority":"Medium","evidence":"","action":""}],
 "risks":[{"title":"","detail":"","priority":"High|Medium|Low","evidence":"","action":""}]
}`);
    return send(res,200,{
      sourceLabel:'AI strategy from public crawl and supplied business context',
      disclaimer:'Recommendations are based on public evidence and user inputs. No unverified performance numbers are claimed.',
      site:{name:website.siteName,url:website.finalUrl,favicon:website.favicon,title:website.title},
      input:business, competitors,
      confidence:String(result.confidence).toLowerCase()==='medium'?'Medium':'Low',
      businessSummary:cleanText(result.businessSummary), marketContext:cleanText(result.marketContext),
      observations:items(result.observations), competitorPatterns:items(result.competitorPatterns),
      technicalPriorities:items(result.technicalPriorities), contentPriorities:items(result.contentPriorities),
      authorityPriorities:items(result.authorityPriorities), conversionPriorities:items(result.conversionPriorities),
      roadmap:phases(result.roadmap), measurementPlan:items(result.measurementPlan), risks:items(result.risks)
    });
  } catch(error){ return send(res,400,{message:error.message}); }
};
