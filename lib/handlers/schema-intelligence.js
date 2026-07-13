'use strict';

const { send, cors, page, fetchText, publicUrl, getBody, gemini, cleanText } = require('../api-lib');

const COMMON_FIELDS = {
  Organization: ['name', 'url'],
  LocalBusiness: ['name', 'address'],
  ProfessionalService: ['name', 'address'],
  Service: ['name', 'provider'],
  Product: ['name', 'offers'],
  Offer: ['price', 'priceCurrency'],
  Article: ['headline', 'author'],
  BlogPosting: ['headline', 'author'],
  NewsArticle: ['headline', 'author', 'datePublished'],
  BreadcrumbList: ['itemListElement'],
  Event: ['name', 'startDate', 'location'],
  JobPosting: ['title', 'datePosted', 'hiringOrganization'],
  Course: ['name', 'provider'],
  Recipe: ['name', 'recipeIngredient'],
  VideoObject: ['name', 'thumbnailUrl', 'uploadDate'],
  SoftwareApplication: ['name', 'operatingSystem'],
  Person: ['name'],
  ProfilePage: ['mainEntity'],
  WebSite: ['name', 'url'],
  WebPage: ['name', 'url'],
  FAQPage: ['mainEntity'],
  HowTo: ['name', 'step'],
  Dataset: ['name', 'description']
};

const SUPPORTED_TYPES = Object.keys(COMMON_FIELDS);

function findObjects(value, output = []) {
  if (Array.isArray(value)) value.forEach((item) => findObjects(item, output));
  else if (value && typeof value === 'object') {
    if (value['@type']) output.push(value);
    Object.values(value).forEach((item) => findObjects(item, output));
  }
  return output;
}

function missing(object, fields) {
  return fields.filter((field) => object[field] == null || object[field] === '' || (Array.isArray(object[field]) && !object[field].length));
}

function schemaTypesFromPage(webpage) {
  const objects = findObjects(webpage.blocks.filter((block) => block.valid).map((block) => block.data));
  const microdataTypes = [...webpage.html.matchAll(/itemtype\s*=\s*["']https?:\/\/schema\.org\/([^"']+)["']/gi)].map((match) => match[1]);
  const rdfaTypes = [...webpage.html.matchAll(/typeof\s*=\s*["']([^"']+)["']/gi)].flatMap((match) => match[1].split(/\s+/)).filter(Boolean);
  return { objects, microdataTypes, rdfaTypes, detectedTypes: [...new Set([...webpage.schemaTypes, ...microdataTypes, ...rdfaTypes])] };
}

function pageFindings(webpage) {
  const parsed = schemaTypesFromPage(webpage);
  const findings = [];
  for (const block of webpage.blocks) {
    if (!block.valid) findings.push({ status: 'fail', title: 'Invalid JSON-LD syntax', detail: block.error, url: webpage.finalUrl });
  }
  for (const object of parsed.objects) {
    const rawType = Array.isArray(object['@type']) ? object['@type'][0] : object['@type'];
    const type = cleanText(rawType, 'Unknown');
    const gaps = missing(object, COMMON_FIELDS[type] || []);
    const contextOkay = ['https://schema.org','http://schema.org'].includes(object['@context']) || object['@context'] == null;
    if (!contextOkay) findings.push({ status: 'warn', title: `${type} uses an unusual @context`, detail: `Found: ${String(object['@context'])}`, url: webpage.finalUrl });
    findings.push({
      status: gaps.length ? 'warn' : 'pass',
      title: `${type} schema ${gaps.length ? 'needs review' : 'found'}`,
      detail: gaps.length ? `Common expected fields missing: ${gaps.join(', ')}` : 'No common field gaps were detected by the local checker.',
      url: webpage.finalUrl,
      type,
      missingFields: gaps
    });
  }
  if (!parsed.detectedTypes.length) findings.push({ status: 'info', title: 'No structured data detected', detail: 'No JSON-LD, Schema.org Microdata or RDFa types were found. Structured data should only be added when it accurately describes visible page content.', url: webpage.finalUrl });
  return { ...parsed, findings };
}

function ruleIntent(webpage) {
  const text = `${webpage.title} ${webpage.description} ${webpage.h1.join(' ')} ${webpage.finalUrl}`.toLowerCase();
  if (/product|price|sku|add to cart|shop/.test(text)) return { intent: 'Product or commerce page', types: ['Product','BreadcrumbList','WebPage'] };
  if (/job|career|vacancy|position/.test(text)) return { intent: 'Job vacancy page', types: ['JobPosting','BreadcrumbList','WebPage'] };
  if (/event|webinar|conference|date and time/.test(text)) return { intent: 'Event page', types: ['Event','BreadcrumbList','WebPage'] };
  if (/article|blog|guide|news|author/.test(text)) return { intent: 'Editorial article', types: ['Article','BreadcrumbList','WebPage'] };
  if (/service|seo|development|design|marketing|consultation/.test(text)) return { intent: 'Service landing page', types: ['Service','Organization','BreadcrumbList','WebPage'] };
  if (/contact|address|phone|hours|location/.test(text)) return { intent: 'Business contact or location page', types: ['LocalBusiness','BreadcrumbList','WebPage'] };
  if (/about|company|team|mission/.test(text)) return { intent: 'Organization information page', types: ['Organization','BreadcrumbList','WebPage'] };
  return { intent: 'General webpage', types: ['WebPage','BreadcrumbList'] };
}

function absolutiseLocs(xml, base) {
  return [...xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)].map((match) => match[1].trim().replace(/&amp;/g, '&')).filter((value) => {
    try { return new URL(value).hostname === new URL(base).hostname; }
    catch { return false; }
  });
}

async function siteUrls(first, maximum = 15) {
  const origin = new URL(first.finalUrl).origin;
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  try {
    const robots = await fetchText(`${origin}/robots.txt`, { timeout: 6000, max: 250000, accept: 'text/plain,*/*' });
    for (const match of String(robots.text || '').matchAll(/^sitemap:\s*(.+)$/gim)) candidates.unshift(match[1].trim());
  } catch {}
  const urls = [first.finalUrl];
  for (const candidate of [...new Set(candidates)].slice(0, 5)) {
    try {
      const safe = await publicUrl(candidate);
      const response = await fetchText(safe, { timeout: 8000, max: 1400000, accept: 'application/xml,text/xml,text/plain' });
      if (!response.response.ok) continue;
      const locs = absolutiseLocs(response.text, origin);
      if (/<sitemapindex\b/i.test(response.text)) {
        for (const child of locs.slice(0, 5)) {
          try {
            const childResponse = await fetchText(child, { timeout: 7000, max: 1400000, accept: 'application/xml,text/xml,text/plain' });
            if (childResponse.response.ok) urls.push(...absolutiseLocs(childResponse.text, origin));
          } catch {}
        }
      } else urls.push(...locs);
    } catch {}
    if (urls.length >= maximum) break;
  }
  if (urls.length < maximum) urls.push(...first.links.filter((link) => { try { return new URL(link.url).origin === origin; } catch { return false; } }).map((link) => link.url));
  return [...new Set(urls.map((url) => url.split('#')[0]))].slice(0, maximum);
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      try { output[current] = await worker(items[current]); }
      catch (error) { output[current] = { url: items[current], error: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, run));
  return output;
}

function organisation(name, url, input) {
  return {
    '@context': 'https://schema.org',
    '@type': input.type || 'Organization',
    name,
    url,
    ...(input.logo ? { logo: input.logo } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.telephone ? { telephone: input.telephone } : {}),
    ...(input.sameAs?.length ? { sameAs: input.sameAs } : {})
  };
}

function buildSchema(type, input = {}, webpage = null) {
  const url = cleanText(input.url || webpage?.finalUrl);
  const name = cleanText(input.name || webpage?.h1?.[0] || webpage?.title, 'Page');
  const description = cleanText(input.description || webpage?.description);
  const base = { '@context': 'https://schema.org', '@type': type };
  const add = (object, key, value) => { if (value !== '' && value != null && (!Array.isArray(value) || value.length)) object[key] = value; };

  if (['Organization','LocalBusiness','ProfessionalService'].includes(type)) {
    const output = organisation(name, url, { ...input, type });
    if (description) output.description = description;
    if (type !== 'Organization' && (input.streetAddress || input.addressLocality || input.addressCountry)) {
      output.address = {
        '@type': 'PostalAddress',
        streetAddress: cleanText(input.streetAddress),
        addressLocality: cleanText(input.addressLocality),
        addressRegion: cleanText(input.addressRegion),
        postalCode: cleanText(input.postalCode),
        addressCountry: cleanText(input.addressCountry)
      };
    }
    if (input.openingHours) output.openingHours = input.openingHours;
    return output;
  }
  if (type === 'Service') {
    return { ...base, name, description, url, serviceType: cleanText(input.serviceType || name), provider: { '@type': 'Organization', name: cleanText(input.providerName), ...(input.providerUrl ? { url: input.providerUrl } : {}) }, ...(input.areaServed ? { areaServed: input.areaServed } : {}) };
  }
  if (type === 'Product') {
    const output = { ...base, name, description, url };
    add(output, 'image', input.image || webpage?.og?.image);
    add(output, 'sku', input.sku);
    if (input.price && input.priceCurrency) output.offers = { '@type': 'Offer', price: String(input.price), priceCurrency: input.priceCurrency, url, availability: input.availability || 'https://schema.org/InStock' };
    return output;
  }
  if (type === 'Offer') return { ...base, price: String(input.price || ''), priceCurrency: cleanText(input.priceCurrency), url, availability: input.availability || 'https://schema.org/InStock' };
  if (['Article','BlogPosting','NewsArticle'].includes(type)) {
    const output = { ...base, headline: cleanText(input.headline || name), description, url, author: { '@type': input.authorType || 'Person', name: cleanText(input.authorName) } };
    add(output, 'image', input.image || webpage?.og?.image);
    add(output, 'datePublished', input.datePublished);
    add(output, 'dateModified', input.dateModified);
    if (input.publisherName) output.publisher = { '@type': 'Organization', name: input.publisherName, ...(input.publisherLogo ? { logo: { '@type': 'ImageObject', url: input.publisherLogo } } : {}) };
    return output;
  }
  if (type === 'BreadcrumbList') {
    const items = Array.isArray(input.items) ? input.items : [{ name: 'Home', url: url ? new URL(url).origin : '' }, { name, url }];
    return { ...base, itemListElement: items.filter((item) => item.name && item.url).map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })) };
  }
  if (type === 'Event') return { ...base, name, description, url, startDate: cleanText(input.startDate), ...(input.endDate ? { endDate: input.endDate } : {}), location: { '@type': input.locationType || 'Place', name: cleanText(input.locationName), address: cleanText(input.locationAddress) }, ...(input.image ? { image: input.image } : {}) };
  if (type === 'JobPosting') return { ...base, title: cleanText(input.title || name), description, datePosted: cleanText(input.datePosted), ...(input.validThrough ? { validThrough: input.validThrough } : {}), employmentType: cleanText(input.employmentType), hiringOrganization: { '@type': 'Organization', name: cleanText(input.hiringOrganization), ...(input.organizationUrl ? { sameAs: input.organizationUrl } : {}) }, jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: cleanText(input.addressLocality), addressCountry: cleanText(input.addressCountry) } } };
  if (type === 'Course') return { ...base, name, description, provider: { '@type': 'Organization', name: cleanText(input.providerName), ...(input.providerUrl ? { sameAs: input.providerUrl } : {}) } };
  if (type === 'Recipe') return { ...base, name, description, image: input.image ? [input.image] : [], recipeIngredient: Array.isArray(input.recipeIngredient) ? input.recipeIngredient : String(input.recipeIngredient || '').split('\n').filter(Boolean), recipeInstructions: String(input.recipeInstructions || '').split('\n').filter(Boolean).map((text) => ({ '@type': 'HowToStep', text })) };
  if (type === 'VideoObject') return { ...base, name, description, thumbnailUrl: input.thumbnailUrl ? [input.thumbnailUrl] : [], uploadDate: cleanText(input.uploadDate), ...(input.contentUrl ? { contentUrl: input.contentUrl } : {}), ...(input.embedUrl ? { embedUrl: input.embedUrl } : {}) };
  if (type === 'SoftwareApplication') return { ...base, name, description, operatingSystem: cleanText(input.operatingSystem), applicationCategory: cleanText(input.applicationCategory), ...(input.price && input.priceCurrency ? { offers: { '@type': 'Offer', price: String(input.price), priceCurrency: input.priceCurrency } } : {}) };
  if (type === 'Person') return { ...base, name, description, url, ...(input.jobTitle ? { jobTitle: input.jobTitle } : {}), ...(input.sameAs?.length ? { sameAs: input.sameAs } : {}) };
  if (type === 'ProfilePage') return { ...base, name, url, mainEntity: { '@type': 'Person', name: cleanText(input.personName || name), ...(input.jobTitle ? { jobTitle: input.jobTitle } : {}) } };
  if (type === 'WebSite') return { ...base, name, url, description, ...(input.searchUrl ? { potentialAction: { '@type': 'SearchAction', target: `${input.searchUrl}{search_term_string}`, 'query-input': 'required name=search_term_string' } } : {}) };
  if (type === 'WebPage') return { ...base, name, url, description, ...(input.isPartOf ? { isPartOf: { '@type': 'WebSite', url: input.isPartOf } } : {}) };
  if (type === 'FAQPage') return { ...base, mainEntity: (input.questions || []).filter((item) => item.question && item.answer).map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) };
  if (type === 'HowTo') return { ...base, name, description, step: (input.steps || []).filter(Boolean).map((text) => ({ '@type': 'HowToStep', text })) };
  if (type === 'Dataset') return { ...base, name, description, url, ...(input.creatorName ? { creator: { '@type': 'Organization', name: input.creatorName } } : {}), ...(input.license ? { license: input.license } : {}) };
  return { ...base, name, url, description };
}

function validateGenerated(schema) {
  const type = Array.isArray(schema['@type']) ? schema['@type'][0] : schema['@type'];
  const missingFields = missing(schema, COMMON_FIELDS[type] || []);
  return { valid: Boolean(schema['@context'] && type && !missingFields.length), type, missingFields };
}

module.exports = async function schemaIntelligence(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const body = getBody(req);
    const mode = cleanText(body.mode, 'analyse');

    if (mode === 'generate') {
      const type = SUPPORTED_TYPES.includes(body.type) ? body.type : 'WebPage';
      const input = body.fields && typeof body.fields === 'object' ? body.fields : {};
      if (typeof input.sameAs === 'string') input.sameAs = input.sameAs.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
      if (typeof input.questions === 'string') {
        input.questions = input.questions.split('\n').map((line) => { const [question, ...answer] = line.split('|'); return { question: cleanText(question), answer: cleanText(answer.join('|')) }; }).filter((item) => item.question && item.answer);
      }
      if (typeof input.steps === 'string') input.steps = input.steps.split('\n').map((item) => item.trim()).filter(Boolean);
      const generated = buildSchema(type, input);
      const validation = validateGenerated(generated);
      return send(res, 200, {
        mode: 'generate',
        sourceLabel: 'Deterministic Schema.org generator',
        generated,
        validation,
        script: `<script type="application/ld+json">\n${JSON.stringify(generated, null, 2)}\n</script>`,
        notices: [
          'The generator uses only the information supplied in the form.',
          'Confirm that every property matches visible page content before implementation.',
          'Validate the final page with Schema.org Validator and Google Rich Results Test where applicable.'
        ]
      });
    }

    const first = await page(body.url);
    const scope = body.scope === 'site' ? 'site' : 'page';
    const urls = scope === 'site' ? await siteUrls(first, Math.min(20, Math.max(2, Number(body.limit) || 12))) : [first.finalUrl];
    const crawled = await mapLimit(urls, 4, async (url) => {
      const webpage = url === first.finalUrl ? first : await page(url);
      const parsed = pageFindings(webpage);
      const rule = ruleIntent(webpage);
      return {
        url: webpage.finalUrl,
        title: webpage.title,
        h1: webpage.h1[0] || '',
        description: webpage.description,
        ogImage: webpage.og.image,
        validBlocks: webpage.blocks.filter((block) => block.valid).length,
        invalidBlocks: webpage.blocks.filter((block) => !block.valid).length,
        detectedTypes: parsed.detectedTypes,
        findings: parsed.findings,
        ruleIntent: rule.intent,
        ruleRecommendations: rule.types,
        webpage
      };
    });

    const evidence = crawled.filter((item) => !item.error).map((item) => ({ url: item.url, title: item.title, h1: item.h1, detectedTypes: item.detectedTypes, intent: item.ruleIntent }));
    let ai = null;
    if (evidence.length) {
      try {
        ai = await gemini(`Analyse this sampled website structured-data evidence. Return strict JSON and never invent business facts, reviews, ratings, prices, addresses or dates.

Pages: ${JSON.stringify(evidence).slice(0, 26000)}

Return {
  "summary":"",
  "siteIntent":"",
  "recommendations":[{"url":"","intent":"","types":[""],"reason":""}],
  "priorities":[{"status":"fail|warn|info","title":"","detail":""}]
}.`);
      } catch { ai = null; }
    }

    const pageReports = crawled.map((item) => {
      if (item.error) return item;
      const aiRecommendation = Array.isArray(ai?.recommendations) ? ai.recommendations.find((recommendation) => recommendation.url === item.url) : null;
      return {
        url: item.url,
        title: item.title,
        h1: item.h1,
        validBlocks: item.validBlocks,
        invalidBlocks: item.invalidBlocks,
        detectedTypes: item.detectedTypes,
        findings: item.findings,
        pageIntent: cleanText(aiRecommendation?.intent, item.ruleIntent),
        recommendedTypes: Array.isArray(aiRecommendation?.types) && aiRecommendation.types.length ? aiRecommendation.types : item.ruleRecommendations,
        recommendationReason: cleanText(aiRecommendation?.reason, 'Recommendation is based on visible page purpose and the structured data detected on the page.')
      };
    });

    let generated = null;
    let generationValidation = null;
    if (body.generate) {
      const target = crawled.find((item) => item.url === body.pageUrl) || crawled[0];
      if (!target || target.error) throw new Error('The selected page could not be used for schema generation.');
      const requestedType = SUPPORTED_TYPES.includes(body.type) ? body.type : (target.ruleRecommendations[0] || 'WebPage');
      generated = buildSchema(requestedType, body.fields || {}, target.webpage);
      generationValidation = validateGenerated(generated);
    }

    const validBlocks = pageReports.reduce((total, item) => total + Number(item.validBlocks || 0), 0);
    const invalidBlocks = pageReports.reduce((total, item) => total + Number(item.invalidBlocks || 0), 0);
    const pagesWithSchema = pageReports.filter((item) => item.detectedTypes?.length).length;

    return send(res, 200, {
      mode: 'analyse',
      scope,
      sourceLabel: 'Live website crawl + structured-data parser + AI-assisted intent review',
      validatorNotice: 'Local checks cover JSON syntax and common fields. Google rich-result eligibility and full Schema.org validation must be confirmed using the official tools.',
      summary: {
        pagesChecked: pageReports.length,
        pagesWithSchema,
        pagesWithoutSchema: pageReports.length - pagesWithSchema,
        validBlocks,
        invalidBlocks,
        detectedTypes: [...new Set(pageReports.flatMap((item) => item.detectedTypes || []))],
        siteIntent: cleanText(ai?.siteIntent, ruleIntent(first).intent),
        aiSummary: cleanText(ai?.summary, `${pagesWithSchema} of ${pageReports.length} sampled pages contain detectable structured data.`)
      },
      priorities: Array.isArray(ai?.priorities) ? ai.priorities.slice(0, 12) : [],
      pages: pageReports,
      supportedTypes: SUPPORTED_TYPES,
      generated,
      generationValidation,
      officialTools: {
        richResults: 'https://search.google.com/test/rich-results',
        schemaValidator: 'https://validator.schema.org/'
      }
    });
  } catch (error) {
    return send(res, 400, { message: error.name === 'AbortError' ? 'The schema crawl timed out. Try page mode or a smaller site sample.' : error.message });
  }
};
