'use strict';

const { send, cors, getBody, page, gemini, cleanText } = require('../api-lib');

const COMMON_FIELDS = {
  Organization: ['name', 'url'],
  LocalBusiness: ['name', 'address', 'telephone'],
  Service: ['name', 'provider'],
  Product: ['name', 'image', 'offers'],
  Article: ['headline', 'author', 'datePublished', 'image'],
  NewsArticle: ['headline', 'author', 'datePublished', 'image'],
  BlogPosting: ['headline', 'author', 'datePublished'],
  BreadcrumbList: ['itemListElement'],
  Event: ['name', 'startDate', 'location'],
  JobPosting: ['title', 'description', 'datePosted', 'hiringOrganization'],
  Recipe: ['name', 'image', 'recipeIngredient'],
  VideoObject: ['name', 'thumbnailUrl', 'uploadDate'],
  SoftwareApplication: ['name', 'operatingSystem'],
  Person: ['name'],
  WebSite: ['name', 'url'],
  WebPage: ['name', 'url'],
  FAQPage: ['mainEntity']
};

const SUPPORTED_TYPES = new Set([
  ...Object.keys(COMMON_FIELDS),
  'ProfilePage',
  'Course',
  'Dataset'
]);

function findObjects(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => findObjects(item, output));
  } else if (value && typeof value === 'object') {
    if (value['@type']) output.push(value);
    Object.values(value).forEach((item) => findObjects(item, output));
  }
  return output;
}

function missing(object, fields) {
  return fields.filter((field) => object[field] == null || object[field] === '');
}

function deterministic(webpage, type) {
  const base = {
    '@context': 'https://schema.org',
    '@type': type,
    name: webpage.h1[0] || webpage.title || 'Page',
    url: webpage.finalUrl,
    description: webpage.description || ''
  };

  if (type === 'Organization' || type === 'LocalBusiness') {
    Object.assign(base, {
      name: webpage.title.split('|')[0].trim() || webpage.h1[0] || 'Organization',
      email: '',
      telephone: '',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '',
        addressLocality: '',
        addressRegion: '',
        postalCode: '',
        addressCountry: ''
      }
    });
  }
  if (type === 'Service') {
    Object.assign(base, {
      serviceType: webpage.h1[0] || webpage.title,
      provider: {
        '@type': 'Organization',
        name: webpage.title.split('|')[0].trim() || 'Organization',
        url: new URL(webpage.finalUrl).origin
      }
    });
  }
  if (['Article', 'BlogPosting', 'NewsArticle'].includes(type)) {
    Object.assign(base, {
      headline: webpage.h1[0] || webpage.title,
      author: {
        '@type': 'Organization',
        name: webpage.title.split('|')[0].trim() || 'Publisher'
      },
      datePublished: '',
      dateModified: '',
      image: webpage.og.image || ''
    });
  }
  if (type === 'Product') {
    Object.assign(base, {
      image: webpage.og.image || '',
      sku: '',
      offers: {
        '@type': 'Offer',
        priceCurrency: '',
        price: '',
        availability: 'https://schema.org/InStock',
        url: webpage.finalUrl
      }
    });
  }
  if (type === 'BreadcrumbList') {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: new URL(webpage.finalUrl).origin
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: webpage.h1[0] || webpage.title,
          item: webpage.finalUrl
        }
      ]
    };
  }
  return base;
}

function unwrapGenerated(value, chosenType) {
  let output = value;
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    if (output.schema && typeof output.schema === 'object') output = output.schema;
    else if (output.jsonLd && typeof output.jsonLd === 'object') output = output.jsonLd;
  }
  if (Array.isArray(output)) output = output[0];
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;

  return {
    '@context': output['@context'] || 'https://schema.org',
    '@type': output['@type'] || chosenType,
    ...output
  };
}

function validRecommendation(item) {
  const type = cleanText(item?.type);
  const reason = cleanText(item?.reason);
  return type && reason ? { type, reason } : null;
}

module.exports = async function schemaIntelligence(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed.' });

  try {
    const body = getBody(req);
    const webpage = await page(body.url);
    const objects = findObjects(webpage.blocks.filter((block) => block.valid).map((block) => block.data));
    const findings = [];

    const microdataTypes = [
      ...webpage.html.matchAll(/itemtype\s*=\s*["']https?:\/\/schema\.org\/([^"']+)["']/gi)
    ].map((match) => match[1]);
    const rdfaTypes = [...webpage.html.matchAll(/typeof\s*=\s*["']([^"']+)["']/gi)]
      .flatMap((match) => match[1].split(/\s+/))
      .filter(Boolean);

    for (const block of webpage.blocks) {
      if (!block.valid) {
        findings.push({
          status: 'fail',
          title: 'Invalid JSON-LD syntax',
          detail: block.error
        });
      }
    }

    for (const object of objects) {
      const rawType = Array.isArray(object['@type']) ? object['@type'][0] : object['@type'];
      const type = cleanText(rawType, 'Unknown');
      const expected = COMMON_FIELDS[type] || [];
      const gaps = missing(object, expected);
      const contextOkay =
        object['@context'] === 'https://schema.org' ||
        object['@context'] === 'http://schema.org' ||
        object['@context'] == null;

      if (!contextOkay) {
        findings.push({
          status: 'warn',
          title: `${type} uses an unusual @context`,
          detail: `Found: ${String(object['@context'])}`
        });
      }
      findings.push({
        status: gaps.length ? 'warn' : 'pass',
        title: `${type} schema ${gaps.length ? 'needs review' : 'found'}`,
        detail: gaps.length
          ? `Commonly expected fields missing: ${gaps.join(', ')}`
          : 'No common field gaps were detected by the local checker.'
      });
    }

    if (microdataTypes.length) {
      findings.push({
        status: 'pass',
        title: 'Microdata detected',
        detail: `Schema types: ${[...new Set(microdataTypes)].join(', ')}`
      });
    }
    if (rdfaTypes.length) {
      findings.push({
        status: 'pass',
        title: 'RDFa attributes detected',
        detail: `Types: ${[...new Set(rdfaTypes)].slice(0, 10).join(', ')}`
      });
    }
    if (!objects.length && !microdataTypes.length && !rdfaTypes.length) {
      findings.push({
        status: 'warn',
        title: 'No structured data detected',
        detail: 'No parseable JSON-LD, Schema.org Microdata, or RDFa type attributes were found.'
      });
    }

    let analysis;
    let analysisSource = 'Rule-based fallback';
    try {
      analysis = await gemini(`Infer the intent of this webpage and recommend only Schema.org types supported by visible page content.

Do not recommend Product, LocalBusiness, Review, FAQPage, Event, JobPosting, or other specific types unless the corresponding information is visibly present. Return strict JSON.

URL: ${webpage.finalUrl}
Title: ${webpage.title}
Description: ${webpage.description}
H1: ${webpage.h1.join(' | ')}
Text excerpt: ${webpage.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 7000)}
Existing types: ${webpage.schemaTypes.join(', ')}

Return {"pageIntent":"","recommendations":[{"type":"","reason":""}],"preferredType":""}.`);
      analysisSource = 'AI-assisted intent analysis';
    } catch {
      analysis = {
        pageIntent: 'General webpage',
        recommendations: [
          { type: 'WebPage', reason: 'WebPage describes a general webpage and its primary topic.' }
        ],
        preferredType: 'WebPage'
      };
    }

    const recommendations = Array.isArray(analysis.recommendations)
      ? analysis.recommendations.map(validRecommendation).filter(Boolean).slice(0, 12)
      : [];
    if (!recommendations.length) {
      recommendations.push({
        type: 'WebPage',
        reason: 'WebPage is the safest general structured-data type for this page.'
      });
    }

    const requestedType = cleanText(body.type);
    const suggestedType = cleanText(analysis.preferredType, recommendations[0].type);
    const chosenType =
      requestedType && requestedType !== 'auto'
        ? requestedType
        : SUPPORTED_TYPES.has(suggestedType)
          ? suggestedType
          : recommendations[0].type || 'WebPage';

    let generated = null;
    let generationSource = null;
    if (body.generate) {
      try {
        const aiGenerated = await gemini(`Generate one valid Schema.org JSON-LD object for the live page below.

Strict rules:
- Use type: ${chosenType}.
- Use only facts visible in the supplied webpage evidence.
- Never invent ratings, reviews, price, address, phone, dates, author, SKU, offers, or business details.
- Use empty strings for required values that are genuinely unavailable.
- Include @context and @type.
- Return the JSON-LD object only.

URL: ${webpage.finalUrl}
Title: ${webpage.title}
Description: ${webpage.description}
H1: ${webpage.h1.join(' | ')}
OG image: ${webpage.og.image}
Visible excerpt: ${webpage.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 9000)}`);
        generated = unwrapGenerated(aiGenerated, chosenType);
        generationSource = generated ? 'AI-assisted from visible page evidence' : null;
      } catch {
        generated = null;
      }
      if (!generated) {
        generated = deterministic(webpage, chosenType);
        generationSource = 'Rule-based template from crawled page fields';
      }
    }

    return send(res, 200, {
      sourceLabel: 'Public crawl + structured-data parser',
      validatorNotice:
        'This tool checks syntax and common fields. Confirm Google rich-result eligibility with Google Rich Results Test after implementation.',
      detectedTypes: [...new Set([...webpage.schemaTypes, ...microdataTypes, ...rdfaTypes])],
      validBlocks: webpage.blocks.filter((block) => block.valid).length,
      invalidBlocks: webpage.blocks.filter((block) => !block.valid).length,
      pageIntent: cleanText(analysis.pageIntent, 'General webpage'),
      analysisSource,
      recommendations,
      findings,
      chosenType,
      generationSource,
      generated
    });
  } catch (error) {
    return send(res, 400, { message: error.message });
  }
};
