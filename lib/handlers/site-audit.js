'use strict';

const { send, cors, page, fetchText, publicUrl, query, getBody, rootDomain } = require('../api-lib');

function finding(category, severity, code, title, detail, url = '', evidence = '', fix = '') {
  return { category, severity, status: severity === 'critical' ? 'fail' : severity === 'warning' ? 'warn' : severity === 'passed' ? 'pass' : 'info', code, title, detail, url, evidence, fix };
}
async function mapLimit(items, limit, worker) {
  const output = new Array(items.length); let index = 0;
  async function run() { while (index < items.length) { const current = index++; try { output[current] = await worker(items[current], current); } catch (error) { output[current] = { __error: error }; } } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}
function parseLocs(xml, origin) {
  return [...String(xml || '').matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((m) => m[1].trim().replace(/&amp;/g, '&'))
    .filter((value) => { try { return new URL(value).origin === origin; } catch { return false; } });
}
async function discoverSitemap(origin, robotsText, maxUrls) {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  for (const match of String(robotsText || '').matchAll(/^sitemap:\s*(.+)$/gim)) candidates.unshift(match[1].trim());
  const files = [], urls = [], queue = [...new Set(candidates)].slice(0, 10), visited = new Set();
  while (queue.length && files.length < 30 && urls.length < maxUrls) {
    const candidate = queue.shift(); if (visited.has(candidate)) continue; visited.add(candidate);
    try {
      const safe = await publicUrl(candidate);
      const result = await fetchText(safe, { timeout: 10000, max: 2000000, accept: 'application/xml,text/xml,text/plain' });
      if (!result.response.ok) continue;
      const locs = parseLocs(result.text, origin); const index = /<sitemapindex\b/i.test(result.text);
      files.push({ url: safe, count: locs.length, type: index ? 'index' : 'urlset', status: result.response.status });
      if (index) queue.push(...locs.slice(0, 30)); else urls.push(...locs);
    } catch {}
  }
  return { files, urls: [...new Set(urls)].slice(0, maxUrls) };
}
function headingSkip(headings) {
  let previous = 0;
  for (const heading of headings || []) { if (previous && heading.level > previous + 1) return { previous, current: heading.level, text: heading.text }; previous = heading.level; }
  return null;
}
function internal(origin, url) { try { return new URL(url).origin === origin; } catch { return false; } }
function normaliseUrl(url) { try { const u = new URL(url); u.hash = ''; return u.toString(); } catch { return url; } }
async function linkStatus(link) {
  let safe;
  try { safe = await publicUrl(link.url); } catch (error) { return { ...link, status: 'Blocked', detail: error.message }; }
  try {
    let result = await fetchText(safe, { method: 'HEAD', timeout: 7000, max: 0, accept: '*/*' });
    if ([405, 501].includes(result.response.status)) result = await fetchText(safe, { method: 'GET', timeout: 7000, max: 2048, accept: '*/*', headers: { Range: 'bytes=0-2047' } });
    return { ...link, status: result.response.status, finalUrl: result.finalUrl || safe };
  } catch (error) { return { ...link, status: 'Unverified', detail: error.name === 'AbortError' ? 'Request timed out.' : error.message }; }
}
function auditPage(p, origin) {
  const findings = [];
  const url = p.finalUrl;
  if (p.status === 'Error') {
    findings.push(finding('Technical SEO','critical','crawl-error','Page could not be crawled',p.error,url,'', 'Confirm the URL is public, returns HTML and does not block the audit bot.'));
    return { page: p, findings, missingAlt: [], links: [] };
  }
  if (!(p.status >= 200 && p.status < 300)) findings.push(finding('Technical SEO','critical','http-status','Non-success HTTP status',`HTTP ${p.status} was returned.`,url,String(p.status),'Fix the source link, redirect obsolete URLs, or restore the expected page.'));
  if (!p.viewport) findings.push(finding('Technical SEO','critical','viewport','Mobile viewport missing','The page does not declare a responsive viewport.',url,'','Add <meta name="viewport" content="width=device-width, initial-scale=1">.'));
  if (/noindex/i.test(`${p.robots} ${p.xRobotsTag}`)) findings.push(finding('Indexability','warning','noindex','Noindex directive found','This page may be excluded from Google Search.',url,`${p.robots} ${p.xRobotsTag}`.trim(),'Remove noindex only when the page should be indexed; keep it for private or duplicate pages.'));
  if (!p.canonical) findings.push(finding('Indexability','warning','canonical-missing','Canonical tag missing','No canonical URL was found.',url,'','Add one self-referencing canonical for the preferred indexable URL.'));
  else if (normaliseUrl(p.canonical) !== normaliseUrl(url)) findings.push(finding('Indexability','info','canonical-other','Canonical points to another URL',p.canonical,url,p.canonical,'Confirm this is intentional and that internal links point to the canonical URL.'));
  if (!p.lang) findings.push(finding('Technical SEO','warning','lang','HTML language missing','The html element has no lang attribute.',url,'','Set the correct BCP 47 language code, for example en-PK.'));
  if (!p.schemaTypes?.length) findings.push(finding('Structured Data','warning','schema-missing','No JSON-LD schema detected','No parseable JSON-LD type was found.',url,'','Add only schema types that match the visible page content.'));
  const invalidBlocks = (p.blocks || []).filter((b) => !b.valid);
  if (invalidBlocks.length) findings.push(finding('Structured Data','critical','schema-invalid','Invalid JSON-LD detected',`${invalidBlocks.length} block(s) could not be parsed.`,url,invalidBlocks[0]?.error || '','Correct the JSON syntax and validate it before publishing.'));
  if (!p.title) findings.push(finding('On-page SEO','critical','title-missing','Title tag missing','The page has no title element.',url,'','Write a specific title that describes the page and search intent.'));
  else if (p.title.length < 30 || p.title.length > 65) findings.push(finding('On-page SEO','warning','title-length','Title length needs review',`${p.title.length} characters.`,url,p.title,'Keep the title descriptive and usually within a concise search-snippet length.'));
  if (!p.description) findings.push(finding('On-page SEO','critical','description-missing','Meta description missing','No search snippet description was found.',url,'','Write a useful summary with a clear reason to visit the page.'));
  else if (p.description.length < 90 || p.description.length > 170) findings.push(finding('On-page SEO','warning','description-length','Meta description length needs review',`${p.description.length} characters.`,url,p.description,'Rewrite it as a concise, accurate page summary.'));
  if (p.h1.length !== 1) findings.push(finding('On-page SEO',p.h1.length ? 'warning' : 'critical','h1','H1 structure issue',`${p.h1.length} H1 headings found.`,url,p.h1.join(' | '),'Use one clear primary heading that matches the page purpose.'));
  const skip = headingSkip(p.headings);
  if (skip) findings.push(finding('On-page SEO','warning','heading-skip','Heading hierarchy skips a level',`H${skip.previous} jumps to H${skip.current}.`,url,skip.text,'Use headings in a logical nested structure for readers and assistive technology.'));
  if (p.wordCount < 180) findings.push(finding('Content','warning','thin-content','Thin page content',`${p.wordCount} visible words were found.`,url,'','Add useful information that answers the page intent; do not pad the page with filler.'));
  if (!p.og?.title || !p.og?.description || !p.og?.image) findings.push(finding('Social & Sharing','warning','og-incomplete','Open Graph metadata incomplete','An OG title, description or image is missing.',url,JSON.stringify(p.og),'Add accurate Open Graph metadata and test the social preview.'));
  const missingAlt = (p.images || []).filter((img) => !img.hasAlt).map((img) => ({ imageUrl: img.src, sourceUrl: url, evidence: img.tag.slice(0, 500) }));
  if (missingAlt.length) findings.push(finding('Images & Accessibility','warning','alt-missing',`${missingAlt.length} image(s) missing alt attributes`,'Exact image URLs are included in the evidence table.',url,missingAlt[0].imageUrl,'Add meaningful alt text for informative images and alt="" for decorative images.'));
  const unsized = (p.images || []).filter((img) => !img.width || !img.height);
  if (unsized.length) findings.push(finding('Images & Accessibility','info','image-dimensions',`${unsized.length} image(s) do not declare dimensions`,'Missing dimensions can contribute to layout shifts.',url,unsized[0].src,'Declare intrinsic width and height or reserve space with CSS aspect-ratio.'));
  const links = (p.links || []).filter((l) => internal(origin, l.url)).map((l) => ({ url: normaliseUrl(l.url), sourceUrl: url, anchor: l.anchor, rel: l.rel }));
  return { page: p, findings, missingAlt, links };
}
async function rdap(hostname) {
  const root = rootDomain(hostname);
  const providers = [`https://rdap.org/domain/${encodeURIComponent(root)}`, `https://rdap.verisign.com/com/v1/domain/${encodeURIComponent(root)}`];
  for (const endpoint of providers) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/rdap+json,application/json' } });
      const data = await response.json(); if (!response.ok) continue;
      const registration = (data.events || []).find((e) => ['registration','registered'].includes(e.eventAction));
      if (!registration?.eventDate) continue;
      const years = (Date.now() - Date.parse(registration.eventDate)) / 31557600000;
      return { domain: root, date: registration.eventDate, ageYears: Math.max(0, years), age: years < 1 ? '<1 year' : `${Math.floor(years)} years`, source: endpoint };
    } catch {}
  }
  return null;
}
async function openPageRank(hostname) {
  if (!process.env.OPENPAGERANK_API_KEY) return { available: false, reason: 'OPENPAGERANK_API_KEY is not configured.' };
  const domain = rootDomain(hostname);
  try {
    const response = await fetch(`https://openpagerank.com/api/v1.0/getPageRank?domains[]=${encodeURIComponent(domain)}`, { headers: { 'API-OPR': process.env.OPENPAGERANK_API_KEY }, signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (!response.ok) return { available: false, reason: data.error || `HTTP ${response.status}` };
    const item = data.response?.[0];
    if (!item || item.status_code !== 200) return { available: false, reason: item?.error || 'No authority data returned.' };
    return { available: true, domain, rank: item.rank ?? null, pageRankDecimal: item.page_rank_decimal ?? null, pageRankInteger: item.page_rank_integer ?? null, source: 'OpenPageRank' };
  } catch (error) { return { available: false, reason: error.message }; }
}
async function commonCrawlSamples(hostname) {
  try {
    const collections = await (await fetch('https://index.commoncrawl.org/collinfo.json', { signal: AbortSignal.timeout(7000) })).json();
    const api = collections?.[0]?.['cdx-api']; if (!api) return [];
    const params = new URLSearchParams({ url: `${rootDomain(hostname)}/*`, output: 'json', filter: 'status:200', collapse: 'urlkey', limit: '20' });
    const response = await fetch(`${api}?${params}`, { signal: AbortSignal.timeout(12000) }); const text = await response.text(); if (!response.ok) return [];
    return text.trim().split('\n').filter(Boolean).slice(0,20).map((line) => { try { const i = JSON.parse(line); return { url: i.url || '', status: i.status || '', timestamp: i.timestamp || '', mime: i.mime || '' }; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

async function discover(requestUrl, maxPages) {
  const first = await page(requestUrl); const origin = new URL(first.finalUrl).origin; const robotsUrl = `${origin}/robots.txt`;
  let robotsText = '', robotsStatus = null;
  try { const r = await fetchText(robotsUrl, { timeout: 8000, max: 400000, accept: 'text/plain,*/*' }); robotsStatus = r.response.status; if (r.response.ok) robotsText = r.text; } catch { robotsStatus = 'Unverified'; }
  const sitemap = await discoverSitemap(origin, robotsText, maxPages);
  let urls = [first.finalUrl, ...sitemap.urls];
  if (!sitemap.urls.length) urls.push(...first.links.filter((l) => internal(origin,l.url)).map((l) => l.url));
  urls = [...new Set(urls.map(normaliseUrl))].slice(0,maxPages);
  return {
    sourceLabel: 'Live public crawl', site: { name: first.siteName, url: first.finalUrl, origin, favicon: first.favicon, title: first.title },
    robots: { url: robotsUrl, status: robotsStatus, found: Boolean(robotsText) }, sitemapFiles: sitemap.files,
    urls, totalDiscovered: urls.length, requestedMaxPages: maxPages,
    note: urls.length >= maxPages ? `The free audit is limited to ${maxPages} discovered URLs for this run.` : 'All discovered sitemap URLs were included.'
  };
}

module.exports = async function siteAudit(req, res) {
  if (cors(req,res)) return;
  try {
    const request = req.method === 'POST' ? getBody(req) : query(req);
    const mode = request.mode || 'legacy';
    if (mode === 'discover') {
      if (req.method !== 'GET' && req.method !== 'POST') return send(res,405,{message:'Method not allowed.'});
      const maxPages = Math.min(500, Math.max(1, Number(request.maxPages || request.limit) || 100));
      return send(res,200,await discover(request.url,maxPages));
    }
    if (mode === 'authority') {
      const safe = await publicUrl(request.url); const hostname = new URL(safe).hostname;
      const [domain, rank, crawlSamples] = await Promise.all([rdap(hostname),openPageRank(hostname),commonCrawlSamples(hostname)]);
      return send(res,200,{sourceLabel:'Public authority signals',domain,openPageRank:rank,crawlSamples,crawlSampleLabel:'Common Crawl indexed URL samples — not backlinks',backlinkNotice:'No paid backlink database is connected, so no backlink count or proprietary DR metric is claimed.',checkedAt:new Date().toISOString()});
    }
    if (mode === 'batch') {
      if (req.method !== 'POST') return send(res,405,{message:'Batch audit requires POST.'});
      const base = await publicUrl(request.baseUrl || request.url); const origin = new URL(base).origin;
      const rawUrls = Array.isArray(request.urls) ? request.urls : [];
      const urls = [];
      for (const value of rawUrls.slice(0,25)) { try { const safe = await publicUrl(value); if (new URL(safe).origin === origin) urls.push(safe); } catch {} }
      if (!urls.length) throw new Error('No valid same-domain URLs were supplied for this audit batch.');
      const pages = await mapLimit(urls,5,async (url) => { try { return await page(url); } catch (error) { return { finalUrl:url,status:'Error',title:'',description:'',h1:[],headings:[],canonical:'',wordCount:0,images:[],links:[],schemaTypes:[],blocks:[],og:{},robots:'',xRobotsTag:'',viewport:'',lang:'',error:error.message }; } });
      const audited = pages.map((p) => auditPage(p,origin));
      const allLinks = audited.flatMap((a) => a.links);
      const uniqueLinks = [...new Map(allLinks.map((l) => [l.url,l])).values()].slice(0,Math.min(80,Number(request.linkLimit)||40));
      const checked = await mapLimit(uniqueLinks,8,linkStatus);
      const broken = checked.filter((l) => [404,410].includes(Number(l.status)) || Number(l.status) >= 500);
      const unverified = checked.filter((l) => ['Unverified','Blocked'].includes(l.status) || [401,403,429].includes(Number(l.status)));
      return send(res,200,{
        sourceLabel:'Live public crawl batch',batch:{requested:rawUrls.length,crawled:pages.length},
        findings:audited.flatMap((a)=>a.findings), missingAlt:audited.flatMap((a)=>a.missingAlt), broken, unverified,
        pages:audited.map((a)=>({url:a.page.finalUrl,status:a.page.status,title:a.page.title,description:a.page.description,h1:a.page.h1?.[0]||'',canonical:a.page.canonical,wordCount:a.page.wordCount,schemaTypes:a.page.schemaTypes||[],images:a.page.images?.length||0,internalLinks:a.links.length,issues:a.findings.length,critical:a.findings.filter((f)=>f.severity==='critical').length,warnings:a.findings.filter((f)=>f.severity==='warning').length,og:a.page.og||{}}))
      });
    }

    // Legacy compatibility: discover and crawl the first requested batch.
    if (req.method !== 'GET') return send(res,405,{message:'Method not allowed.'});
    const maxPages = Math.min(50,Math.max(1,Number(request.limit)||25));
    const discovery = await discover(request.url,maxPages);
    const fakeReq = { ...req, method:'POST', body:{mode:'batch',baseUrl:discovery.site.url,urls:discovery.urls.slice(0,maxPages),linkLimit:50} };
    const collector = { headers:{}, setHeader(k,v){this.headers[k]=v;}, end(value){this.value=value;this.writableEnded=true;}, statusCode:200 };
    await module.exports(fakeReq,collector);
    const batch = JSON.parse(collector.value || '{}');
    const authorityReq = { ...req, method:'GET', query:{mode:'authority',url:discovery.site.url} };
    const authCollector = { headers:{}, setHeader(k,v){this.headers[k]=v;}, end(value){this.value=value;this.writableEnded=true;}, statusCode:200 };
    await module.exports(authorityReq,authCollector);
    const authority = JSON.parse(authCollector.value || '{}');
    return send(res,200,{...discovery,...batch,authority});
  } catch (error) {
    return send(res,400,{message:error.name==='AbortError'?'The website took too long to respond. Try a smaller batch.':error.message});
  }
};
