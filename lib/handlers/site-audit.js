'use strict';

const {
  send,
  cors,
  page,
  fetchText,
  publicUrl,
  query
} = require('../api-lib');

function issue(status, title, detail = '', url = '') {
  return { status, title, detail, url };
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      try {
        output[current] = await worker(items[current], current);
      } catch (error) {
        output[current] = { __error: error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

function parseLocs(xml, baseUrl) {
  return [...xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].trim().replace(/&amp;/g, '&'))
    .filter((value) => {
      try {
        return new URL(value).hostname === new URL(baseUrl).hostname;
      } catch {
        return false;
      }
    });
}

async function discoverSitemap(origin, robotsText, maxUrls) {
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  for (const match of String(robotsText || '').matchAll(/^sitemap:\s*(.+)$/gim)) {
    candidates.unshift(match[1].trim());
  }

  const sitemapFiles = [];
  const pageUrls = [];
  const queue = [...new Set(candidates)].slice(0, 6);
  const visited = new Set();

  while (queue.length && sitemapFiles.length < 12 && pageUrls.length < maxUrls) {
    const candidate = queue.shift();
    if (visited.has(candidate)) continue;
    visited.add(candidate);

    try {
      const safe = await publicUrl(candidate);
      const result = await fetchText(safe, {
        timeout: 8000,
        max: 1500000,
        accept: 'application/xml,text/xml,text/plain'
      });
      if (!result.response.ok) continue;
      const locs = parseLocs(result.text, origin);
      const isIndex = /<sitemapindex\b/i.test(result.text);
      sitemapFiles.push({ url: safe, count: locs.length, type: isIndex ? 'index' : 'urlset' });

      if (isIndex) {
        for (const location of locs.slice(0, 10)) {
          if (!visited.has(location)) queue.push(location);
        }
      } else {
        pageUrls.push(...locs);
      }
    } catch {
      // A missing or blocked sitemap is reported later without failing the full audit.
    }
  }

  return {
    files: sitemapFiles,
    urls: [...new Set(pageUrls)].slice(0, maxUrls)
  };
}

async function linkStatus(link) {
  let safe;
  try {
    safe = await publicUrl(link.url);
  } catch (error) {
    return { ...link, status: 'Blocked', detail: error.message };
  }

  try {
    let result = await fetchText(safe, {
      method: 'HEAD',
      timeout: 6500,
      max: 0,
      accept: '*/*'
    });
    if ([405, 501].includes(result.response.status)) {
      result = await fetchText(safe, {
        method: 'GET',
        timeout: 6500,
        max: 2048,
        accept: '*/*',
        headers: { Range: 'bytes=0-2047' }
      });
    }
    return {
      ...link,
      status: result.response.status,
      finalUrl: result.finalUrl || safe
    };
  } catch (error) {
    return {
      ...link,
      status: 'Unverified',
      detail: error.name === 'AbortError' ? 'Request timed out.' : error.message
    };
  }
}

async function rdap(hostname) {
  try {
    const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(hostname)}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/rdap+json,application/json' }
    });
    const data = await response.json();
    if (!response.ok) return null;
    const registration = (data.events || []).find(
      (event) => event.eventAction === 'registration' || event.eventAction === 'registered'
    );
    if (!registration?.eventDate) return null;
    const years = (Date.now() - Date.parse(registration.eventDate)) / 31557600000;
    return {
      date: registration.eventDate,
      age: years < 1 ? '<1 year' : `${Math.floor(years)} years`
    };
  } catch {
    return null;
  }
}

async function openPageRank(hostname) {
  if (!process.env.OPENPAGERANK_API_KEY) return null;
  try {
    const response = await fetch(
      `https://openpagerank.com/api/v1.0/getPageRank?domains[]=${encodeURIComponent(hostname)}`,
      {
        headers: { 'API-OPR': process.env.OPENPAGERANK_API_KEY },
        signal: AbortSignal.timeout(9000)
      }
    );
    const data = await response.json();
    if (!response.ok) return null;
    return data.response?.[0] || null;
  } catch {
    return null;
  }
}

async function commonCrawlSamples(hostname) {
  try {
    const collectionsResponse = await fetch('https://index.commoncrawl.org/collinfo.json', {
      signal: AbortSignal.timeout(6000)
    });
    const collections = await collectionsResponse.json();
    const api = collections?.[0]?.['cdx-api'];
    if (!api) return [];

    const params = new URLSearchParams({
      url: `${hostname}/*`,
      output: 'json',
      filter: 'status:200',
      collapse: 'urlkey',
      limit: '8'
    });
    const response = await fetch(`${api}?${params}`, { signal: AbortSignal.timeout(9000) });
    const text = await response.text();
    if (!response.ok) return [];

    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(0, 8)
      .map((line) => {
        try {
          const item = JSON.parse(line);
          return {
            url: item.url || '',
            status: item.status || '',
            timestamp: item.timestamp || '',
            mime: item.mime || ''
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
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
  return [...grouped.entries()]
    .filter(([, urls]) => urls.length > 1)
    .map(([value, urls]) => ({ value, urls }));
}

module.exports = async function siteAudit(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const request = query(req);
    const firstPage = await page(request.url);
    const requestedLimit = Number(request.limit) || 25;
    const limit = Math.min(50, Math.max(1, requestedLimit));
    const origin = new URL(firstPage.finalUrl).origin;
    const hostname = new URL(firstPage.finalUrl).hostname;
    const robotsUrl = `${origin}/robots.txt`;

    let robotsText = '';
    let robotsStatus = null;
    try {
      const robots = await fetchText(robotsUrl, {
        timeout: 6500,
        max: 350000,
        accept: 'text/plain,*/*'
      });
      robotsStatus = robots.response.status;
      if (robots.response.ok) robotsText = robots.text;
    } catch {
      robotsStatus = 'Unverified';
    }

    const sitemap = await discoverSitemap(origin, robotsText, limit);
    let urls = [firstPage.finalUrl];
    if (sitemap.urls.length) {
      urls.push(...sitemap.urls);
    } else {
      urls.push(
        ...firstPage.links
          .filter((link) => {
            try {
              return new URL(link.url).origin === origin;
            } catch {
              return false;
            }
          })
          .map((link) => link.url)
      );
    }
    urls = [...new Set(urls.map((url) => url.split('#')[0]))].slice(0, limit);

    const crawledPages = await mapLimit(urls, 5, async (url) => {
      try {
        return await page(url);
      } catch (error) {
        return {
          finalUrl: url,
          status: 'Error',
          title: '',
          description: '',
          h1: [],
          headings: [],
          canonical: '',
          wordCount: 0,
          images: [],
          links: [],
          schemaTypes: [],
          blocks: [],
          og: {},
          robots: '',
          xRobotsTag: '',
          viewport: '',
          lang: '',
          error: error.message
        };
      }
    });

    const technical = [];
    const onPage = [];
    const missingAlt = [];
    const allLinks = [];

    for (const currentPage of crawledPages) {
      const url = currentPage.finalUrl;
      if (currentPage.status === 'Error') {
        technical.push(issue('fail', 'Page could not be crawled', currentPage.error, url));
        continue;
      }

      if (!(currentPage.status >= 200 && currentPage.status < 400)) {
        technical.push(
          issue('fail', 'Non-success HTTP status', `Status ${currentPage.status}`, url)
        );
      }
      if (!currentPage.viewport) {
        technical.push(
          issue('fail', 'Mobile viewport missing', 'Add a responsive viewport meta tag.', url)
        );
      }
      if (/noindex/i.test(`${currentPage.robots} ${currentPage.xRobotsTag}`)) {
        technical.push(
          issue('warn', 'Noindex directive found', 'The page may be excluded from search.', url)
        );
      }
      if (!currentPage.canonical) {
        technical.push(
          issue('warn', 'Canonical tag missing', 'Add an appropriate canonical URL.', url)
        );
      }
      if (!currentPage.lang) {
        technical.push(
          issue('warn', 'HTML language missing', 'Set the lang attribute on the html element.', url)
        );
      }
      if (!currentPage.schemaTypes?.length) {
        technical.push(
          issue(
            'warn',
            'No JSON-LD schema detected',
            'Review whether structured data is appropriate for this page.',
            url
          )
        );
      }
      const invalidSchemaCount = (currentPage.blocks || []).filter((block) => !block.valid).length;
      if (invalidSchemaCount) {
        technical.push(
          issue(
            'fail',
            'Invalid JSON-LD block detected',
            `${invalidSchemaCount} JSON-LD block(s) could not be parsed.`,
            url
          )
        );
      }

      if (!currentPage.title) {
        onPage.push(issue('fail', 'Title tag missing', 'Add a descriptive title tag.', url));
      } else if (currentPage.title.length < 30 || currentPage.title.length > 65) {
        onPage.push(
          issue(
            'warn',
            'Title length needs review',
            `${currentPage.title.length} characters: ${currentPage.title}`,
            url
          )
        );
      }
      if (!currentPage.description) {
        onPage.push(
          issue('fail', 'Meta description missing', 'Add a useful search snippet description.', url)
        );
      } else if (
        currentPage.description.length < 90 ||
        currentPage.description.length > 170
      ) {
        onPage.push(
          issue(
            'warn',
            'Meta description length needs review',
            `${currentPage.description.length} characters.`,
            url
          )
        );
      }
      if (currentPage.h1.length !== 1) {
        onPage.push(
          issue(
            currentPage.h1.length === 0 ? 'fail' : 'warn',
            'H1 structure issue',
            `${currentPage.h1.length} H1 headings found.`,
            url
          )
        );
      }
      if (hasHeadingSkip(currentPage.headings)) {
        onPage.push(
          issue(
            'warn',
            'Heading levels are skipped',
            'Review the H1–H6 hierarchy for skipped levels.',
            url
          )
        );
      }
      if (currentPage.wordCount < 180) {
        onPage.push(
          issue('warn', 'Thin page content', `${currentPage.wordCount} visible words found.`, url)
        );
      }
      if (!currentPage.og?.title || !currentPage.og?.description || !currentPage.og?.image) {
        onPage.push(
          issue(
            'warn',
            'Open Graph metadata incomplete',
            'Add an OG title, description, and image for reliable social previews.',
            url
          )
        );
      }

      for (const image of currentPage.images || []) {
        if (!image.hasAlt) missingAlt.push({ imageUrl: image.src, sourceUrl: url });
      }
      for (const link of currentPage.links || []) {
        allLinks.push({ url: link.url, sourceUrl: url, anchor: link.anchor });
      }
    }

    for (const duplicate of duplicateMap(crawledPages, 'title')) {
      onPage.push(
        issue(
          'warn',
          'Duplicate title detected',
          `${duplicate.urls.length} crawled pages share the same title: ${duplicate.urls.join(', ')}`
        )
      );
    }
    for (const duplicate of duplicateMap(crawledPages, 'description')) {
      onPage.push(
        issue(
          'warn',
          'Duplicate meta description detected',
          `${duplicate.urls.length} crawled pages share the same description: ${duplicate.urls.join(', ')}`
        )
      );
    }

    const uniqueLinks = [...new Map(allLinks.map((link) => [link.url, link])).values()].slice(0, 100);
    const checkedLinks = await mapLimit(uniqueLinks, 10, linkStatus);
    const broken = checkedLinks.filter(
      (link) =>
        Number(link.status) === 404 ||
        Number(link.status) === 410 ||
        Number(link.status) >= 500
    );
    const unverified = checkedLinks.filter(
      (link) =>
        ['Unverified', 'Blocked'].includes(link.status) ||
        [401, 403, 429].includes(Number(link.status))
    );

    const [domainInfo, rankInfo, crawlSamples] = await Promise.all([
      rdap(hostname),
      openPageRank(hostname),
      commonCrawlSamples(hostname)
    ]);

    const resources = [];
    resources.push(
      robotsText
        ? issue('pass', 'robots.txt found', `HTTP ${robotsStatus}. Open the live file.`, robotsUrl)
        : issue(
            'warn',
            'robots.txt not found or inaccessible',
            `Status: ${robotsStatus ?? 'Unknown'}.`,
            robotsUrl
          )
    );
    if (sitemap.files.length) {
      resources.push(
        ...sitemap.files.map((file) =>
          issue(
            'pass',
            file.type === 'index' ? 'XML sitemap index found' : 'XML sitemap found',
            `${file.count} <loc> entries detected in this file.`,
            file.url
          )
        )
      );
    } else {
      resources.push(
        issue(
          'warn',
          'XML sitemap not found or inaccessible',
          'No accessible sitemap.xml or sitemap_index.xml was detected.',
          `${origin}/sitemap.xml`
        )
      );
    }

    const critical = [...technical, ...onPage].filter((item) => item.status === 'fail').length;
    const warningCount =
      [...technical, ...onPage].filter((item) => item.status === 'warn').length +
      missingAlt.length +
      broken.length;
    const score = Math.max(0, 100 - critical * 8 - Math.min(45, warningCount * 2));

    return send(res, 200, {
      sourceLabel: 'Live public crawl',
      auditScope: `Crawled up to ${limit} same-domain URLs and checked up to 100 unique links.`,
      summary: {
        pagesCrawled: crawledPages.length,
        critical,
        warnings: warningCount,
        score
      },
      technical: { resources, issues: technical },
      onPage: { issues: onPage, ogPreview: firstPage.og },
      links: {
        missingAlt: missingAlt.slice(0, 100),
        broken: broken.slice(0, 100),
        unverified: unverified.slice(0, 100)
      },
      pages: crawledPages.map((currentPage) => ({
        url: currentPage.finalUrl,
        status: currentPage.status,
        title: currentPage.title,
        description: currentPage.description,
        h1: currentPage.h1?.[0] || '',
        canonical: currentPage.canonical,
        wordCount: currentPage.wordCount,
        schemaTypes: currentPage.schemaTypes || []
      })),
      authority: {
        openPageRank: rankInfo?.page_rank_decimal ?? null,
        openPageRankLabel: rankInfo ? 'Open PageRank public metric' : 'Not connected',
        domainAge: domainInfo?.age || null,
        registrationDate: domainInfo?.date || null,
        crawlSamples,
        crawlSampleLabel: 'Common Crawl indexed URL samples — not backlinks',
        backlinkDataAvailable: false,
        backlinkNotice:
          'No verified backlink database is connected. Common Crawl samples show crawl presence, not referring-domain or backlink counts.',
        confidence: rankInfo ? 'Medium' : 'Low'
      }
    });
  } catch (error) {
    return send(res, 400, {
      message:
        error.name === 'AbortError'
          ? 'The website took too long to respond. Try a smaller crawl limit.'
          : error.message
    });
  }
};
