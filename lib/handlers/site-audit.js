'use strict';

const { send, cors, page, fetchText, publicUrl, query } = require('../api-lib');
const { registrableDomain } = require('../domain-utils');

function issue(status, title, detail = '', url = '', extra = {}) {
  const priority = extra.priority || (status === 'fail' ? 'High' : status === 'warn' ? 'Medium' : 'Low');
  return {
    status,
    title,
    detail,
    url,
    priority,
    impact: extra.impact || '',
    effort: extra.effort || '',
    howToFix: extra.howToFix || '',
    evidence: extra.evidence || null,
    category: extra.category || ''
  };
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      try { output[current] = await worker(items[current], current); }
      catch (error) { output[current] = { __error: error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, run));
  return output;
}

function parseLocs(xml, baseUrl) {
  return [...xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].trim().replace(/&amp;/g, '&'))
    .filter((value) => {
      try { return new URL(value).hostname === new URL(baseUrl).hostname; }
      catch { return false; }
    });
}

async function discoverSitemap(origin, robotsText, maxUrls) {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  for (const match of String(robotsText || '').matchAll(/^sitemap:\s*(.+)$/gim)) candidates.unshift(match[1].trim());
  const sitemapFiles = [];
  const pageUrls = [];
  const queue = [...new Set(candidates)].slice(0, 8);
  const visited = new Set();

  while (queue.length && sitemapFiles.length < 16 && pageUrls.length < maxUrls) {
    const candidate = queue.shift();
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    try {
      const safe = await publicUrl(candidate);
      const result = await fetchText(safe, { timeout: 9000, max: 2000000, accept: 'application/xml,text/xml,text/plain' });
      if (!result.response.ok) continue;
      const locs = parseLocs(result.text, origin);
      const isIndex = /<sitemapindex\b/i.test(result.text);
      sitemapFiles.push({ url: safe, count: locs.length, type: isIndex ? 'index' : 'urlset', status: result.response.status });
      if (isIndex) {
        for (const location of locs.slice(0, 14)) if (!visited.has(location)) queue.push(location);
      } else pageUrls.push(...locs);
    } catch {
      // Missing or blocked sitemap is reported without aborting the audit.
    }
  }
  return { files: sitemapFiles, urls: [...new Set(pageUrls)].slice(0, maxUrls) };
}

async function linkStatus(link) {
  let safe;
  try { safe = await publicUrl(link.url); }
  catch (error) { return { ...link, status: 'Blocked', detail: error.message }; }
  try {
    let result = await fetchText(safe, { method: 'HEAD', timeout: 7000, max: 0, accept: '*/*' });
    if ([405, 501].includes(result.response.status)) {
      result = await fetchText(safe, { method: 'GET', timeout: 7000, max: 2048, accept: '*/*', headers: { Range: 'bytes=0-2047' } });
    }
    return { ...link, status: result.response.status, finalUrl: result.finalUrl || safe };
  } catch (error) {
    return { ...link, status: 'Unverified', detail: error.name === 'AbortError' ? 'Request timed out.' : error.message };
  }
}

async function rdap(domain) {
  const endpoints = [`https://rdap.org/domain/${encodeURIComponent(domain)}`];
  if (/\.(com|net)$/i.test(domain)) endpoints.push(`https://rdap.verisign.com/${domain.split('.').pop()}/v1/domain/${encodeURIComponent(domain)}`);
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(9000), headers: { Accept: 'application/rdap+json,application/json' } });
      const data = await response.json();
      if (!response.ok) continue;
      const registration = (data.events || []).find((event) => ['registration','registered'].includes(event.eventAction));
      const date = registration?.eventDate || '';
      const years = date ? (Date.now() - Date.parse(date)) / 31557600000 : null;
      return {
        source: endpoint,
        date: date || null,
        ageYears: years == null || !Number.isFinite(years) ? null : Math.max(0, years),
        age: years == null || !Number.isFinite(years) ? null : years < 1 ? '<1 year' : `${Math.floor(years)} years`,
        status: (data.status || []).join(', '),
        registrar: (data.entities || []).find((entity) => (entity.roles || []).includes('registrar'))?.vcardArray?.[1]?.find((row) => row[0] === 'fn')?.[3] || ''
      };
    } catch {
      // Try another bootstrap endpoint.
    }
  }
  return null;
}

async function openPageRank(domain) {
  if (!process.env.OPENPAGERANK_API_KEY) return { available: false, reason: 'OPENPAGERANK_API_KEY is not configured.' };
  try {
    const response = await fetch(`https://openpagerank.com/api/v1.0/getPageRank?domains[]=${encodeURIComponent(domain)}`, {
      headers: { 'API-OPR': process.env.OPENPAGERANK_API_KEY },
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (!response.ok) return { available: false, reason: data.error || `OpenPageRank returned HTTP ${response.status}.` };
    const result = data.response?.[0];
    if (!result || result.status_code !== 200) return { available: false, reason: result?.error || 'No OpenPageRank record was returned.' };
    return {
      available: true,
      domain,
      rank: result.rank ?? null,
      pageRankInteger: result.page_rank_integer ?? null,
      pageRankDecimal: result.page_rank_decimal ?? null,
      source: 'OpenPageRank',
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return { available: false, reason: error.name === 'AbortError' ? 'OpenPageRank request timed out.' : error.message };
  }
}

async function commonCrawlSamples(domain) {
  try {
    const collectionsResponse = await fetch('https://index.commoncrawl.org/collinfo.json', { signal: AbortSignal.timeout(7000) });
    const collections = await collectionsResponse.json();
    const api = collections?.[0]?.['cdx-api'];
    if (!api) return [];
    const params = new URLSearchParams({ url: `${domain}/*`, output: 'json', filter: 'status:200', collapse: 'urlkey', limit: '12' });
    const response = await fetch(`${api}?${params}`, { signal: AbortSignal.timeout(10000) });
    const text = await response.text();
    if (!response.ok) return [];
    return text.trim().split('\n').filter(Boolean).slice(0, 12).map((line) => {
      try {
        const item = JSON.parse(line);
        return { url: item.url || '', status: item.status || '', timestamp: item.timestamp || '', mime: item.mime || '' };
      } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function hasHeadingSkip(headings) {
  let previous = 0;
  for (const heading of headings || []) {
    if (previous && heading.level > previous + 1) return true;
    previous = heading.level;
  }
  return false;
}

function duplicateMap(pages, field) {
  const grouped = new Map();
  for (const pageData of pages) {
    const value = String(pageData[field] || '').trim().toLowerCase();
    if (!value) continue;
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(pageData.finalUrl);
  }
  return [...grouped.entries()].filter(([, urls]) => urls.length > 1).map(([value, urls]) => ({ value, urls }));
}

function tokenise(value) {
  return new Set(String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((word) => word.length > 2));
}

function overlap(left, right) {
  const a = tokenise(left);
  const b = tokenise(right);
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((word) => b.has(word)).length;
  return common / Math.min(a.size, b.size);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function scoreFromIssues(issues, { fail = 12, warn = 4, info = 0 } = {}) {
  const penalty = issues.reduce((total, item) => total + (item.status === 'fail' ? fail : item.status === 'warn' ? warn : info), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function classifyPath(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path === '/' || path === '') return 'Homepage';
    if (/product|shop|cart|category/.test(path)) return 'Commerce';
    if (/blog|article|news|guide|resource/.test(path)) return 'Editorial';
    if (/service|solution|seo|development|design|marketing/.test(path)) return 'Service';
    if (/contact|about|privacy|terms/.test(path)) return 'Trust';
    return 'General';
  } catch { return 'General'; }
}

function normaliseUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch { return value; }
}

module.exports = async function siteAudit(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const request = query(req);
    const firstPage = await page(request.url);
    const requestedLimit = Number(request.limit) || 30;
    const limit = Math.min(60, Math.max(1, requestedLimit));
    const origin = new URL(firstPage.finalUrl).origin;
    const hostname = new URL(firstPage.finalUrl).hostname;
    const rootDomain = registrableDomain(hostname);
    const robotsUrl = `${origin}/robots.txt`;

    let robotsText = '';
    let robotsStatus = null;
    try {
      const robots = await fetchText(robotsUrl, { timeout: 7000, max: 350000, accept: 'text/plain,*/*' });
      robotsStatus = robots.response.status;
      if (robots.response.ok) robotsText = robots.text;
    } catch { robotsStatus = 'Unverified'; }

    const sitemap = await discoverSitemap(origin, robotsText, limit);
    let urls = [firstPage.finalUrl];
    if (sitemap.urls.length) urls.push(...sitemap.urls);
    else urls.push(...firstPage.links.filter((link) => { try { return new URL(link.url).origin === origin; } catch { return false; } }).map((link) => link.url));
    urls = [...new Set(urls.map(normaliseUrl))].slice(0, limit);

    const crawledPages = await mapLimit(urls, 5, async (url) => {
      try { return await page(url); }
      catch (error) {
        return {
          finalUrl: url, status: 'Error', title: '', description: '', h1: [], headings: [], canonical: '', wordCount: 0,
          images: [], links: [], schemaTypes: [], blocks: [], og: {}, twitter: {}, robots: '', xRobotsTag: '', viewport: '',
          lang: '', favicon: '', error: error.message, text: ''
        };
      }
    });

    const technical = [];
    const onPage = [];
    const contentIssues = [];
    const schemaIssues = [];
    const socialIssues = [];
    const wins = [];
    const missingAlt = [];
    const allLinks = [];
    const pageByUrl = new Map(crawledPages.map((item) => [normaliseUrl(item.finalUrl), item]));

    for (const currentPage of crawledPages) {
      const url = currentPage.finalUrl;
      if (currentPage.status === 'Error') {
        technical.push(issue('fail', 'Page could not be crawled', currentPage.error, url, { category: 'Crawlability', impact: 'The page could not be evaluated and may also be inaccessible to search engines.', effort: 'Medium', howToFix: 'Check server availability, firewall rules, DNS and redirect behaviour.' }));
        continue;
      }

      if (!(currentPage.status >= 200 && currentPage.status < 400)) technical.push(issue('fail', 'Non-success HTTP status', `Status ${currentPage.status}`, url, { category: 'HTTP', impact: 'Users and crawlers may not receive a usable page.', howToFix: 'Return a valid 200 response for indexable pages or use the correct redirect/status intentionally.' }));
      if (!currentPage.viewport) technical.push(issue('fail', 'Mobile viewport missing', 'A responsive viewport meta tag was not found.', url, { category: 'Mobile', impact: 'The page may render poorly on mobile devices.', effort: 'Low', howToFix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' }));
      else wins.push(issue('pass', 'Responsive viewport detected', '', url, { category: 'Mobile' }));
      if (/noindex/i.test(`${currentPage.robots} ${currentPage.xRobotsTag}`)) technical.push(issue('warn', 'Noindex directive found', 'The page may be excluded from search results.', url, { category: 'Indexability', impact: 'This URL may not be eligible for organic visibility.', howToFix: 'Confirm the noindex directive is intentional. Remove it only when the page should be indexed.' }));
      if (!currentPage.canonical) technical.push(issue('warn', 'Canonical tag missing', 'No canonical URL was detected.', url, { category: 'Canonicalisation', howToFix: 'Add a self-referencing or intentionally selected canonical URL in the document head.' }));
      else wins.push(issue('pass', 'Canonical tag found', currentPage.canonical, url, { category: 'Canonicalisation' }));
      if (!currentPage.lang) technical.push(issue('warn', 'HTML language missing', 'The html element has no lang attribute.', url, { category: 'Internationalisation', effort: 'Low', howToFix: 'Set a valid language code such as en-PK on the html element.' }));
      const invalidSchemaCount = (currentPage.blocks || []).filter((block) => !block.valid).length;
      if (invalidSchemaCount) schemaIssues.push(issue('fail', 'Invalid JSON-LD block detected', `${invalidSchemaCount} JSON-LD block(s) could not be parsed.`, url, { category: 'Structured data', impact: 'Invalid syntax prevents structured data from being understood.', howToFix: 'Correct JSON syntax and validate the final page in Schema.org Validator and Google Rich Results Test.' }));
      if (currentPage.schemaTypes?.length) wins.push(issue('pass', 'Structured data detected', currentPage.schemaTypes.join(', '), url, { category: 'Structured data' }));

      if (!currentPage.title) onPage.push(issue('fail', 'Title tag missing', 'Add a descriptive and unique title tag.', url, { category: 'Title', impact: 'Search engines and users lack a clear page label.', effort: 'Low', howToFix: 'Write a concise title that reflects the page intent and primary topic.' }));
      else if (currentPage.title.length < 30 || currentPage.title.length > 65) onPage.push(issue('warn', 'Title length needs review', `${currentPage.title.length} characters: ${currentPage.title}`, url, { category: 'Title', howToFix: 'Keep the title concise, descriptive and free of repetitive keywords. Search snippets can truncate by device.' }));
      else wins.push(issue('pass', 'Title length is within a practical range', `${currentPage.title.length} characters`, url, { category: 'Title' }));

      if (!currentPage.description) onPage.push(issue('fail', 'Meta description missing', 'No meta description was detected.', url, { category: 'Snippet', effort: 'Low', howToFix: 'Write a useful page-specific summary that helps a searcher understand the page.' }));
      else if (currentPage.description.length < 90 || currentPage.description.length > 170) onPage.push(issue('warn', 'Meta description length needs review', `${currentPage.description.length} characters.`, url, { category: 'Snippet', howToFix: 'Focus on a clear, relevant summary rather than a rigid character target.' }));

      if (currentPage.h1.length !== 1) onPage.push(issue(currentPage.h1.length === 0 ? 'fail' : 'warn', 'H1 structure issue', `${currentPage.h1.length} H1 headings found.`, url, { category: 'Headings', effort: 'Low', howToFix: 'Use one clear primary heading that describes the main purpose of the page.' }));
      if (hasHeadingSkip(currentPage.headings)) onPage.push(issue('warn', 'Heading levels are skipped', 'The H1–H6 sequence contains a hierarchy jump.', url, { category: 'Headings', effort: 'Low', howToFix: 'Use headings to represent content hierarchy, not visual size.' }));

      const pageType = classifyPath(url);
      const thinThreshold = ['Service','Editorial','Commerce'].includes(pageType) ? 350 : 220;
      if (currentPage.wordCount < thinThreshold) contentIssues.push(issue('warn', 'Limited visible page content', `${currentPage.wordCount} visible words found on a ${pageType.toLowerCase()} page.`, url, { category: 'Content depth', impact: 'The page may not answer enough of the visitor’s questions or demonstrate sufficient expertise.', howToFix: 'Add original, useful sections that address decisions, process, deliverables, evidence, limitations and next steps.' }));
      if (currentPage.title && currentPage.h1[0] && overlap(currentPage.title, currentPage.h1[0]) < 0.25) contentIssues.push(issue('warn', 'Title and H1 may target different topics', `Title: ${currentPage.title} | H1: ${currentPage.h1[0]}`, url, { category: 'Intent alignment', effort: 'Low', howToFix: 'Align the title and main heading around the same primary page intent without making them identical.' }));

      if (!currentPage.og?.title || !currentPage.og?.description || !currentPage.og?.image) socialIssues.push(issue('warn', 'Open Graph metadata incomplete', 'A complete OG title, description and image were not found.', url, { category: 'Social preview', effort: 'Low', howToFix: 'Add og:title, og:description, og:image, og:url and an appropriate og:type.' }));
      else wins.push(issue('pass', 'Open Graph preview is configured', '', url, { category: 'Social preview' }));

      for (const image of currentPage.images || []) {
        if (!image.hasAlt) missingAlt.push({ imageUrl: image.src, sourceUrl: url, currentAlt: image.alt || '', issue: 'Missing alt attribute' });
      }
      for (const link of currentPage.links || []) allLinks.push({ url: normaliseUrl(link.url), sourceUrl: url, anchor: link.anchor });
    }

    const duplicateTitles = duplicateMap(crawledPages, 'title');
    const duplicateDescriptions = duplicateMap(crawledPages, 'description');
    for (const duplicate of duplicateTitles) onPage.push(issue('warn', 'Duplicate title detected', `${duplicate.urls.length} crawled pages share the same title.`, duplicate.urls[0] || '', { category: 'Duplication', evidence: duplicate.urls, howToFix: 'Give each indexable page a title that reflects its distinct purpose.' }));
    for (const duplicate of duplicateDescriptions) onPage.push(issue('warn', 'Duplicate meta description detected', `${duplicate.urls.length} crawled pages share the same description.`, duplicate.urls[0] || '', { category: 'Duplication', evidence: duplicate.urls, howToFix: 'Write a distinct summary for each important page.' }));

    const uniqueLinks = [...new Map(allLinks.map((link) => [link.url, link])).values()].slice(0, 150);
    const checkedLinks = await mapLimit(uniqueLinks, 10, linkStatus);
    const broken = checkedLinks.filter((link) => Number(link.status) === 404 || Number(link.status) === 410 || Number(link.status) >= 500);
    const redirected = checkedLinks.filter((link) => Number(link.status) >= 300 && Number(link.status) < 400);
    const unverified = checkedLinks.filter((link) => ['Unverified','Blocked'].includes(link.status) || [401,403,429].includes(Number(link.status)));

    const inbound = new Map();
    const outbound = new Map();
    for (const pageData of crawledPages) {
      const source = normaliseUrl(pageData.finalUrl);
      const targets = new Set((pageData.links || []).map((link) => normaliseUrl(link.url)).filter((link) => pageByUrl.has(link)));
      outbound.set(source, targets.size);
      for (const target of targets) {
        if (!inbound.has(target)) inbound.set(target, new Set());
        inbound.get(target).add(source);
      }
    }
    const start = normaliseUrl(firstPage.finalUrl);
    const depth = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const source = queue.shift();
      const currentDepth = depth.get(source) || 0;
      const pageData = pageByUrl.get(source);
      for (const link of pageData?.links || []) {
        const target = normaliseUrl(link.url);
        if (pageByUrl.has(target) && !depth.has(target)) {
          depth.set(target, currentDepth + 1);
          queue.push(target);
        }
      }
    }
    const orphanRisk = crawledPages.filter((item) => normaliseUrl(item.finalUrl) !== start && (inbound.get(normaliseUrl(item.finalUrl))?.size || 0) === 0).map((item) => item.finalUrl);
    const deepPages = crawledPages.filter((item) => (depth.get(normaliseUrl(item.finalUrl)) ?? 99) > 3).map((item) => ({ url: item.finalUrl, depth: depth.get(normaliseUrl(item.finalUrl)) }));

    const [domainInfo, rankInfo, crawlSamples] = await Promise.all([
      rdap(rootDomain),
      openPageRank(rootDomain),
      commonCrawlSamples(rootDomain)
    ]);

    const resources = [
      robotsText
        ? issue('pass', 'robots.txt found', `HTTP ${robotsStatus}. Open the live file.`, robotsUrl, { category: 'Crawl directives' })
        : issue('warn', 'robots.txt not found or inaccessible', `Status: ${robotsStatus ?? 'Unknown'}.`, robotsUrl, { category: 'Crawl directives', howToFix: 'Create a valid robots.txt only when crawl directives or sitemap discovery are needed.' })
    ];
    if (sitemap.files.length) resources.push(...sitemap.files.map((file) => issue('pass', file.type === 'index' ? 'XML sitemap index found' : 'XML sitemap found', `${file.count} <loc> entries detected.`, file.url, { category: 'Sitemaps' })));
    else resources.push(issue('warn', 'XML sitemap not found or inaccessible', 'No accessible sitemap.xml or sitemap_index.xml was detected.', `${origin}/sitemap.xml`, { category: 'Sitemaps', howToFix: 'Generate a sitemap containing canonical, indexable URLs and reference it in robots.txt or Search Console.' }));

    if (broken.length) technical.push(issue('fail', 'Broken links detected', `${broken.length} checked links returned 404, 410 or 5xx responses.`, broken[0]?.url || '', { category: 'Links', evidence: broken.slice(0, 50), impact: 'Broken links interrupt user journeys and waste crawl paths.', howToFix: 'Update the source link, restore the destination or redirect the old URL to a relevant replacement.' }));
    if (orphanRisk.length) technical.push(issue('warn', 'Orphan-risk pages detected', `${orphanRisk.length} crawled pages received no internal links from the sampled crawl.`, orphanRisk[0], { category: 'Internal linking', evidence: orphanRisk, howToFix: 'Link important pages from relevant navigation, hubs or contextual content.' }));
    if (deepPages.length) technical.push(issue('warn', 'Important pages may be too deep', `${deepPages.length} pages were more than three clicks from the starting page.`, deepPages[0]?.url || '', { category: 'Site architecture', evidence: deepPages, howToFix: 'Strengthen hub pages, navigation and contextual internal links.' }));
    if (missingAlt.length) onPage.push(issue('warn', 'Images missing alt attributes', `${missingAlt.length} image instances were found without an alt attribute.`, missingAlt[0]?.sourceUrl || '', { category: 'Images', evidence: missingAlt.slice(0, 100), howToFix: 'Add concise descriptive alt text for informative images and alt="" for decorative images.' }));

    const visibleWordCounts = crawledPages.filter((item) => item.status !== 'Error').map((item) => Number(item.wordCount || 0));
    const trustPaths = {
      about: crawledPages.find((item) => /\/about\/?$/i.test(new URL(item.finalUrl).pathname)),
      contact: crawledPages.find((item) => /\/contact\/?$/i.test(new URL(item.finalUrl).pathname)),
      privacy: crawledPages.find((item) => /\/privacy\/?$/i.test(new URL(item.finalUrl).pathname)),
      terms: crawledPages.find((item) => /\/terms\/?$/i.test(new URL(item.finalUrl).pathname))
    };
    const trustSignals = [
      { label: 'About page', found: Boolean(trustPaths.about), url: trustPaths.about?.finalUrl || '' },
      { label: 'Contact page', found: Boolean(trustPaths.contact), url: trustPaths.contact?.finalUrl || '' },
      { label: 'Privacy page', found: Boolean(trustPaths.privacy), url: trustPaths.privacy?.finalUrl || '' },
      { label: 'Terms page', found: Boolean(trustPaths.terms), url: trustPaths.terms?.finalUrl || '' },
      { label: 'Organization or LocalBusiness schema', found: crawledPages.some((item) => (item.schemaTypes || []).some((type) => ['Organization','LocalBusiness','ProfessionalService'].includes(type))), url: firstPage.finalUrl },
      { label: 'HTTPS', found: firstPage.finalUrl.startsWith('https://'), url: firstPage.finalUrl }
    ];

    const technicalScore = scoreFromIssues(technical, { fail: 12, warn: 4 });
    const onPageScore = scoreFromIssues(onPage, { fail: 10, warn: 3 });
    const contentScore = scoreFromIssues(contentIssues, { fail: 10, warn: 5 });
    const schemaScore = Math.max(0, 100 - schemaIssues.filter((item) => item.status === 'fail').length * 20 - Math.max(0, crawledPages.filter((item) => item.schemaTypes?.length).length === 0 ? 10 : 0));
    const linksScore = Math.max(0, 100 - broken.length * 7 - orphanRisk.length * 3 - deepPages.length * 2);
    const socialScore = scoreFromIssues(socialIssues, { fail: 10, warn: 7 });
    const overallScore = Math.round(technicalScore * 0.28 + onPageScore * 0.22 + contentScore * 0.18 + linksScore * 0.14 + schemaScore * 0.1 + socialScore * 0.08);

    const allIssues = [...technical, ...onPage, ...contentIssues, ...schemaIssues, ...socialIssues];
    const critical = allIssues.filter((item) => item.status === 'fail').length;
    const warningCount = allIssues.filter((item) => item.status === 'warn').length;
    const topRecommendations = allIssues
      .filter((item) => ['fail','warn'].includes(item.status))
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1))
      .slice(0, 12)
      .map((item, index) => ({
        order: index + 1,
        title: item.title,
        reason: item.impact || item.detail,
        action: item.howToFix || 'Review the affected evidence and implement the appropriate correction.',
        priority: item.priority,
        url: item.url
      }));

    return send(res, 200, {
      sourceLabel: 'Live public crawl',
      auditScope: `Crawled ${crawledPages.length} same-domain URLs (maximum ${limit}) and checked ${checkedLinks.length} unique links (maximum 150).`,
      generatedAt: new Date().toISOString(),
      site: {
        requestedUrl: firstPage.requestedUrl,
        finalUrl: firstPage.finalUrl,
        origin,
        hostname,
        rootDomain,
        name: firstPage.og?.title || firstPage.title?.split('|')[0]?.trim() || hostname,
        title: firstPage.title,
        favicon: firstPage.favicon,
        responseTimeMs: firstPage.ms
      },
      summary: {
        pagesCrawled: crawledPages.length,
        linksChecked: checkedLinks.length,
        critical,
        warnings: warningCount,
        wins: wins.length,
        score: overallScore,
        scores: {
          technical: technicalScore,
          onPage: onPageScore,
          content: contentScore,
          internalLinks: linksScore,
          schema: schemaScore,
          social: socialScore
        },
        recommendations: topRecommendations
      },
      technical: { resources, issues: technical },
      onPage: { issues: onPage, ogPreview: firstPage.og, socialIssues },
      content: {
        issues: contentIssues,
        averageWords: visibleWordCounts.length ? Math.round(visibleWordCounts.reduce((a, b) => a + b, 0) / visibleWordCounts.length) : 0,
        medianWords: Math.round(median(visibleWordCounts)),
        thinnestPages: crawledPages.filter((item) => item.status !== 'Error').sort((a, b) => a.wordCount - b.wordCount).slice(0, 15).map((item) => ({ url: item.finalUrl, wordCount: item.wordCount, type: classifyPath(item.finalUrl) })),
        duplicateTitles,
        duplicateDescriptions,
        trustSignals,
        guidance: 'These are observable website trust and transparency signals, not a direct E-E-A-T or ranking score.'
      },
      schema: {
        issues: schemaIssues,
        pagesWithSchema: crawledPages.filter((item) => item.schemaTypes?.length).length,
        pagesWithoutSchema: crawledPages.filter((item) => !item.schemaTypes?.length).length,
        types: [...new Set(crawledPages.flatMap((item) => item.schemaTypes || []))]
      },
      links: {
        missingAlt: missingAlt.slice(0, 150),
        broken: broken.slice(0, 150),
        redirects: redirected.slice(0, 100),
        unverified: unverified.slice(0, 100),
        orphanRisk: orphanRisk.slice(0, 100),
        deepPages: deepPages.slice(0, 100)
      },
      wins: wins.slice(0, 100),
      pages: crawledPages.map((currentPage) => {
        const key = normaliseUrl(currentPage.finalUrl);
        return {
          url: currentPage.finalUrl,
          status: currentPage.status,
          title: currentPage.title,
          description: currentPage.description,
          h1: currentPage.h1?.[0] || '',
          canonical: currentPage.canonical,
          wordCount: currentPage.wordCount,
          schemaTypes: currentPage.schemaTypes || [],
          type: classifyPath(currentPage.finalUrl),
          depth: depth.get(key) ?? null,
          internalLinksIn: inbound.get(key)?.size || 0,
          internalLinksOut: outbound.get(key) || 0,
          error: currentPage.error || ''
        };
      }),
      authority: {
        domain: rootDomain,
        openPageRank: rankInfo,
        domainAge: domainInfo,
        crawlSamples,
        crawlSampleLabel: 'Common Crawl indexed URL samples — not backlinks',
        backlinkDataAvailable: false,
        backlinkNotice: 'No verified commercial backlink database is connected. Common Crawl samples indicate crawl presence, not backlink or referring-domain totals.',
        confidence: rankInfo?.available || domainInfo ? 'Medium' : 'Low'
      },
      limits: {
        freeReport: 'Website-level summary with sampled page evidence.',
        futurePro: 'Full page-by-page crawl inventory, scheduled monitoring and expanded exports can be offered as a paid plan.'
      }
    });
  } catch (error) {
    return send(res, 400, {
      message: error.name === 'AbortError' ? 'The website took too long to respond. Try a smaller crawl limit.' : error.message
    });
  }
};
