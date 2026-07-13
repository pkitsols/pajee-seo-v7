# Final QA Report

Date: 13 July 2026

## Scope tested

- 40 HTML pages
- 21 backend JavaScript files
- 3 Vercel Serverless Functions
- 56 inline browser scripts
- 39 JSON-LD blocks
- 11 detailed individual service pages

## Automated results

- Backend JavaScript syntax: pass
- Inline JavaScript syntax: pass
- JSON-LD parsing: pass
- Exactly one H1 per page: pass
- Titles, meta descriptions, canonicals and viewport tags: pass
- Duplicate page titles: 0
- Duplicate meta descriptions: 0
- Individual service-page visible content: 799–875 words
- Internal links checked: 3,311
- Missing internal targets: 0
- API contract tests: 13 passed, 0 failed
- Hobby Function count: 3 of 12

## Responsive results

Static pages were checked at:

- 390 × 844 mobile
- 768 × 1024 iPad portrait
- 1440 × 900 desktop

Results:

- 120 page/viewport checks
- Horizontal overflow: 0
- Oversized SVG/icon issues: 0
- Page JavaScript errors: 0

Dynamic result interfaces were also checked on mobile and iPad for Google reporting, PageSpeed, Website Audit and Complete Growth Report.

## Interaction tests

Passed:

- Mobile navigation
- Contact-form validation/success UI
- Google connected/disconnected UI
- GSC/GA4 source switching
- Recommended property selection
- Report charts and metric rendering
- CSV and print/PDF actions
- Schema analysis and generation
- Schema copy/download actions
- PageSpeed score gauges and help drawer
- Website-audit filters and exact affected URLs
- Complete Growth Report modules and progress states
- Tool CTAs passing the website URL into the next report page

## Accuracy safeguards

- AI estimates are labelled and not presented as official Google data.
- GSC and GA4 verified data are kept separate.
- INP is not replaced by TBT when field data is unavailable.
- Missing alt, broken links, robots and sitemap findings include direct evidence where available.
- Common Crawl samples are not described as complete backlink counts.
- OpenPageRank and domain age show unavailable instead of fabricated values when sources fail.
- Generated schema does not invent ratings, reviews, prices, addresses or other missing facts.

## Production limitation

Code paths and controlled API contracts passed. Final third-party production responses depend on the real Vercel environment variables, Google property permissions, API quotas and the tested website's available data. A live test must be completed after deployment.
