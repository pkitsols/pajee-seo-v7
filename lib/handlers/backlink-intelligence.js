'use strict';

const {
  send,
  cors,
  getBody,
  query,
  publicUrl,
  fetchText,
  absolutise,
  attr,
  strip,
  rootDomain,
  page,
  gemini
} = require('../api-lib');

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9'
};

function environmentFlag(name, fallback = true) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return !['0', 'false', 'off', 'no'].includes(value);
}

function classifyGeminiError(error) {
  const message = String(error?.message || error || '');
  if (/RESOURCE_EXHAUSTED|quota|rate limit|billing details|429/i.test(message)) return 'quota';
  if (/UNAVAILABLE|overloaded|temporarily unavailable|503/i.test(message)) return 'temporary';
  if (/API key|PERMISSION_DENIED|UNAUTHENTICATED|permission|401|403/i.test(message)) return 'credentials';
  if (/model .*not found|NOT_FOUND|no longer available|404/i.test(message)) return 'model';
  if (/timed out|AbortError|network|fetch failed/i.test(message)) return 'network';
  return 'other';
}

function fallbackWarning(reason) {
  const messages = {
    quota: 'Gemini quota is exhausted, so backlink discovery continued automatically with public-search fallback queries.',
    temporary: 'Gemini is temporarily unavailable, so backlink discovery continued automatically with public-search fallback queries.',
    credentials: 'Gemini is not configured or its credentials are unavailable, so backlink discovery continued with public-search fallback queries.',
    model: 'The configured Gemini model is unavailable, so backlink discovery continued with public-search fallback queries.',
    network: 'Gemini could not be reached, so backlink discovery continued with public-search fallback queries.',
    other: 'Gemini assistance was unavailable, so backlink discovery continued with public-search fallback queries.'
  };
  return messages[reason] || messages.other;
}

function defaultSearchQueries(target) {
  const host = new URL(target).hostname.replace(/^www\./i, '');
  return [
    `"${host}" -site:${host}`,
    `"https://${host}" OR "http://${host}" -site:${host}`
  ];
}

function normaliseSuggestedQuery(value, host) {
  const searchQuery = String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!searchQuery || searchQuery.length > 180) return '';
  if (!searchQuery.toLowerCase().includes(host.toLowerCase())) return '';
  return searchQuery;
}

async function optionalGeminiQueryPlan(target, website) {
  const fallback = defaultSearchQueries(target);
  const host = new URL(target).hostname.replace(/^www\./i, '');
  const enabled = environmentFlag('BACKLINK_GEMINI_ASSIST', true);

  if (!enabled) {
    return {
      queries: fallback,
      ai: {
        status: 'disabled',
        reason: 'disabled',
        model: null,
        warning: 'Gemini assistance is disabled. Public-search fallback queries were used.'
      }
    };
  }

  if (!String(process.env.GEMINI_API_KEY || '').trim()) {
    return {
      queries: fallback,
      ai: {
        status: 'fallback',
        reason: 'not_configured',
        model: null,
        warning: fallbackWarning('credentials')
      }
    };
  }

  try {
    const data = await gemini(`Create two concise public web-search queries that may discover pages linking to the target website. These queries will only find candidates; Pajee SEO will fetch every result and verify the actual HTML link before counting it. Include the exact domain in every query. Return strict JSON only as {"queries":[""]}.

Domain: ${host}
Website name: ${website?.siteName || ''}
Page title: ${website?.title || ''}`);

    const suggestions = Array.isArray(data?.queries)
      ? data.queries
        .map((value) => normaliseSuggestedQuery(value, host))
        .filter(Boolean)
        .slice(0, 2)
      : [];

    if (!suggestions.length) {
      return {
        queries: fallback,
        ai: {
          status: 'fallback',
          reason: 'empty_response',
          model: 'gemini-3.5-flash',
          warning: 'Gemini returned no usable query suggestions, so public-search fallback queries were used.'
        }
      };
    }

    return {
      queries: [...new Set([...fallback, ...suggestions])].slice(0, 4),
      ai: {
        status: 'used',
        reason: null,
        model: 'gemini-3.5-flash',
        warning: null
      }
    };
  } catch (error) {
    const reason = classifyGeminiError(error);
    return {
      queries: fallback,
      ai: {
        status: 'fallback',
        reason,
        model: null,
        warning: fallbackWarning(reason)
      }
    };
  }
}

async function openPageRank(host) {
  if (!process.env.OPENPAGERANK_API_KEY) return null;
  try {
    const domain = rootDomain(host);
    const response = await fetch(
      `https://openpagerank.com/api/v1.0/getPageRank?domains[]=${encodeURIComponent(domain)}`,
      {
        headers: { 'API-OPR': process.env.OPENPAGERANK_API_KEY },
        signal: AbortSignal.timeout(9000)
      }
    );
    const data = await response.json();
    return response.ok ? data.response?.[0] || null : null;
  } catch {
    return null;
  }
}

function htmlDecode(value = '') {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, number) => {
      const code = Number(number);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
}

function unwrapSearchUrl(rawUrl, baseUrl) {
  let value = htmlDecode(rawUrl).trim();
  if (!value) return '';
  if (value.startsWith('//')) value = `https:${value}`;

  try {
    const url = new URL(value, baseUrl);
    if (/duckduckgo\.com$/i.test(url.hostname)) {
      const direct = url.searchParams.get('uddg');
      if (direct) return decodeURIComponent(direct);
    }
    if (/r\.search\.yahoo\.com$/i.test(url.hostname)) {
      const match = url.pathname.match(/\/RU=([^/]+)/i);
      if (match) return decodeURIComponent(match[1]);
    }
    return url.toString();
  } catch {
    return '';
  }
}

function candidateUrl(rawUrl, baseUrl, targetRoot) {
  const unwrapped = unwrapSearchUrl(rawUrl, baseUrl);
  if (!unwrapped || !/^https?:\/\//i.test(unwrapped)) return '';

  try {
    const url = new URL(unwrapped);
    const sourceRoot = rootDomain(url.hostname);
    const blocked = new Set([
      'duckduckgo.com',
      'bing.com',
      'microsoft.com',
      'yahoo.com',
      'google.com',
      'googleusercontent.com'
    ]);
    if (!sourceRoot || sourceRoot === targetRoot || blocked.has(sourceRoot)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function normaliseDomainHint(value, targetRoot = '') {
  let raw = String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
  if (!raw) return '';

  try {
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const hostname = new URL(raw).hostname.replace(/^www\./i, '');
    const domain = rootDomain(hostname);
    if (!domain || domain === targetRoot) return '';
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return '';
    return domain;
  } catch {
    return '';
  }
}

function parseDuckDuckGo(html, targetRoot) {
  const results = [];
  const patterns = [
    /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["']/gi,
    /<a\b[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*result__a[^"']*["']/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const url = candidateUrl(match[1], 'https://html.duckduckgo.com/', targetRoot);
      if (url) results.push(url);
    }
  }
  return [...new Set(results)];
}

function parseBing(html, targetRoot) {
  const results = [];
  const blocks = html.match(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][\s\S]*?<\/li>/gi) || [];
  for (const block of blocks) {
    const match = block.match(/<h2\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["']/i)
      || block.match(/<a\b[^>]*href=["']([^"']+)["']/i);
    if (!match) continue;
    const url = candidateUrl(match[1], 'https://www.bing.com/', targetRoot);
    if (url) results.push(url);
  }
  return [...new Set(results)];
}

async function searchDuckDuckGo(searchQuery, targetRoot) {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
  const fetched = await fetchText(searchUrl, {
    timeout: 9000,
    max: 1400000,
    headers: BROWSER_HEADERS
  });
  if (!fetched.response.ok) throw new Error(`DuckDuckGo returned HTTP ${fetched.response.status}.`);
  return parseDuckDuckGo(fetched.text, targetRoot);
}

async function searchBing(searchQuery, targetRoot) {
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}&count=30&setlang=en`;
  const fetched = await fetchText(searchUrl, {
    timeout: 9000,
    max: 1600000,
    headers: BROWSER_HEADERS
  });
  if (!fetched.response.ok) throw new Error(`Bing returned HTTP ${fetched.response.status}.`);
  return parseBing(fetched.text, targetRoot);
}

async function runPublicSearch(searches, targetRoot) {
  const tasks = [];
  for (const searchQuery of searches.slice(0, 24)) {
    tasks.push({ source: 'DuckDuckGo', promise: searchDuckDuckGo(searchQuery, targetRoot) });
    tasks.push({ source: 'Bing', promise: searchBing(searchQuery, targetRoot) });
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.promise));
  const urls = [];
  const sources = new Set();
  const warnings = [];

  settled.forEach((result, index) => {
    const source = tasks[index].source;
    if (result.status === 'fulfilled') {
      if (result.value.length) sources.add(source);
      urls.push(...result.value);
    } else {
      warnings.push(`${source} discovery was temporarily unavailable.`);
    }
  });

  return {
    urls: [...new Set(urls)].slice(0, 100),
    sources: [...sources],
    warnings: [...new Set(warnings)]
  };
}

async function publicSearchCandidates(target, searches = defaultSearchQueries(target)) {
  const targetRoot = rootDomain(new URL(target).hostname);
  return runPublicSearch(searches, targetRoot);
}

async function publicSearchDomainHints(target, domains) {
  const host = new URL(target).hostname.replace(/^www\./i, '');
  const targetRoot = rootDomain(host);
  const safeDomains = [...new Set(
    (Array.isArray(domains) ? domains : [])
      .map((value) => normaliseDomainHint(value, targetRoot))
      .filter(Boolean)
  )].slice(0, 12);

  const searches = safeDomains.map((domain) => `site:${domain} "${host}"`);
  const discovery = await runPublicSearch(searches, targetRoot);
  return {
    ...discovery,
    domainsUsed: safeDomains
  };
}

async function verifyOne(source, target) {
  try {
    const targetRoot = rootDomain(new URL(target).hostname);
    const fetched = await fetchText(source, {
      timeout: 10000,
      max: 1500000,
      headers: BROWSER_HEADERS
    });
    const sourceUrl = fetched.finalUrl || source;
    if (rootDomain(new URL(sourceUrl).hostname) === targetRoot) return null;

    const anchors = fetched.text.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
    for (const tag of anchors) {
      const href = absolutise(attr(tag, 'href'), sourceUrl);
      if (!href || !/^https?:/i.test(href)) continue;
      let hostname;
      try { hostname = new URL(href).hostname; } catch { continue; }
      if (rootDomain(hostname) !== targetRoot) continue;

      const rel = attr(tag, 'rel').toLowerCase();
      return {
        sourceUrl,
        targetUrl: href,
        sourceDomain: rootDomain(new URL(sourceUrl).hostname),
        anchor: strip(tag).slice(0, 180),
        rel,
        follow: !/(nofollow|sponsored|ugc)/.test(rel),
        httpStatus: fetched.response.status,
        live: fetched.response.ok,
        checkedAt: new Date().toISOString()
      };
    }

    return {
      sourceUrl,
      sourceDomain: rootDomain(new URL(sourceUrl).hostname),
      live: false,
      noLinkFound: true,
      httpStatus: fetched.response.status,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      sourceUrl: source,
      live: false,
      error: error.message,
      checkedAt: new Date().toISOString()
    };
  }
}

function score(links, rank) {
  const live = links.filter((link) => link.live && !link.noLinkFound);
  if (!live.length) return 0;

  const domains = new Set(live.map((link) => link.sourceDomain)).size;
  const followRatio = live.filter((link) => link.follow).length / live.length;
  const domainCounts = Object.values(live.reduce((accumulator, link) => {
    accumulator[link.sourceDomain] = (accumulator[link.sourceDomain] || 0) + 1;
    return accumulator;
  }, {})).sort((a, b) => b - a);
  const concentration = (domainCounts[0] || 0) / live.length;
  const openPageRank = Number(rank?.page_rank_decimal || 0);

  return Math.max(0, Math.min(100, Math.round(
    domains * 8
    + Math.min(22, live.length * 2)
    + followRatio * 16
    + openPageRank * 4
    - Math.max(0, (concentration - 0.45) * 28)
  )));
}

function confidence(liveCount, candidateCount) {
  if (!candidateCount) return 'Insufficient evidence';
  if (liveCount >= 20) return 'High';
  if (liveCount >= 5) return 'Medium';
  return 'Low';
}

async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    const input = req.method === 'POST' ? await getBody(req) : query(req);
    const target = await publicUrl(input.url);
    const requestedMode = ['discover', 'verify', 'domain-discover'].includes(input.mode)
      ? input.mode
      : 'verify';
    const website = await page(target).catch(() => null);
    let effectiveMode = requestedMode;
    let candidates = Array.isArray(input.urls) ? input.urls : [];
    const domainHints = Array.isArray(input.domains) ? input.domains : [];
    let discovery = {
      urls: [],
      sources: [],
      warnings: [],
      domainsUsed: [],
      ai: { status: 'not_used', reason: null, model: null, warning: null }
    };

    if (requestedMode === 'discover') {
      const queryPlan = await optionalGeminiQueryPlan(target, website);
      discovery = {
        ...await publicSearchCandidates(target, queryPlan.queries),
        ai: queryPlan.ai,
        domainsUsed: []
      };
      if (queryPlan.ai.warning) discovery.warnings.push(queryPlan.ai.warning);
      if (queryPlan.ai.status === 'used') discovery.sources.unshift('Gemini query planning');
      candidates = discovery.urls;
    } else if (requestedMode === 'domain-discover' || (!candidates.length && domainHints.length)) {
      effectiveMode = 'domain-discover';
      discovery = {
        ...await publicSearchDomainHints(target, domainHints),
        ai: { status: 'not_used', reason: null, model: null, warning: null }
      };
      candidates = discovery.urls;
      if (!discovery.domainsUsed.length) {
        discovery.warnings.push('The imported sheet did not contain usable external referring domains. Public website discovery was used instead.');
        const fallbackDiscovery = await publicSearchCandidates(target);
        discovery.urls = fallbackDiscovery.urls;
        discovery.sources = fallbackDiscovery.sources;
        discovery.warnings.push(...fallbackDiscovery.warnings);
        candidates = fallbackDiscovery.urls;
        effectiveMode = 'discover-fallback';
      }
    } else if (!candidates.length) {
      const fallbackDiscovery = await publicSearchCandidates(target);
      discovery = {
        ...fallbackDiscovery,
        domainsUsed: [],
        ai: { status: 'not_used', reason: null, model: null, warning: null }
      };
      discovery.warnings.push('No source-page URLs were found in the imported sheet, so public backlink discovery was used automatically.');
      candidates = fallbackDiscovery.urls;
      effectiveMode = 'discover-fallback';
    }

    candidates = [...new Set(candidates
      .map((value) => String(value || '').trim())
      .filter((value) => /^https?:\/\//i.test(value))
    )].slice(0, 100);

    const results = [];
    for (let index = 0; index < candidates.length; index += 8) {
      const batch = await Promise.all(candidates.slice(index, index + 8).map((url) => verifyOne(url, target)));
      results.push(...batch.filter(Boolean));
    }

    const live = results.filter((result) => result?.live && !result.noLinkFound);
    const rank = await openPageRank(new URL(target).hostname);
    const warnings = [...discovery.warnings];

    if ((effectiveMode === 'discover' || effectiveMode === 'discover-fallback' || effectiveMode === 'domain-discover') && !candidates.length) {
      warnings.push('No public backlink candidates were returned during this scan. Import Latest Links, More Sample Links, or Top linking sites from Google Search Console for a deeper check.');
    } else if ((effectiveMode === 'discover' || effectiveMode === 'discover-fallback' || effectiveMode === 'domain-discover') && candidates.length && !live.length) {
      warnings.push('Candidate pages were found, but no live HTML backlink was confirmed during this scan.');
    }

    let sourceLabel = 'Imported source URLs + live HTML verification';
    if (effectiveMode === 'discover') {
      sourceLabel = discovery.ai?.status === 'used'
        ? 'Optional Gemini query planning + public search + live HTML verification'
        : 'Public-search fallback + live HTML verification';
    } else if (effectiveMode === 'discover-fallback') {
      sourceLabel = 'Automatic public-search fallback + live HTML verification';
    } else if (effectiveMode === 'domain-discover') {
      sourceLabel = 'Imported referring domains + public search + live HTML verification';
    }

    return send(res, 200, {
      sourceLabel,
      requestedMode,
      effectiveMode,
      discoverySources: discovery.sources,
      importedDomainsUsed: discovery.domainsUsed || [],
      aiAssist: discovery.ai,
      warnings: [...new Set(warnings)],
      fallbackAvailable: true,
      disclaimer: 'This is a verified public sample, not a complete Google backlink index. Only public candidate pages that were fetched and confirmed to contain a live link are counted.',
      site: {
        name: website?.siteName || new URL(target).hostname,
        url: target,
        favicon: website?.favicon || ''
      },
      authority: {
        name: 'Pajee Authority Signal',
        score: score(live, rank),
        openPageRank: rank?.page_rank_decimal ?? null,
        confidence: confidence(live.length, candidates.length)
      },
      summary: {
        candidates: candidates.length,
        verifiedLive: live.length,
        referringDomains: new Set(live.map((link) => link.sourceDomain)).size,
        followLinks: live.filter((link) => link.follow).length,
        nofollowLinks: live.filter((link) => !link.follow).length,
        unverified: results.filter((result) => !result.live).length
      },
      links: results
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
}

handler._test = {
  environmentFlag,
  classifyGeminiError,
  defaultSearchQueries,
  normaliseSuggestedQuery,
  htmlDecode,
  unwrapSearchUrl,
  candidateUrl,
  normaliseDomainHint,
  parseDuckDuckGo,
  parseBing,
  score,
  confidence
};

module.exports = handler;
