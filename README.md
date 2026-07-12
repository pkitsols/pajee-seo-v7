# Pajee SEO — Vercel Hobby Final Build

This is the GitHub/Vercel-ready production folder for the Pajee SEO multi-page website and SEO tool suite.

## Hobby-plan architecture

The project deploys **one Vercel Function only**:

- `api/router.js`

All public API routes are preserved through rewrites in `vercel.json`. The working backend modules are stored under `lib/handlers/`, so Vercel bundles them into the router instead of counting them as separate Functions.

## Included tools

- Complete SEO Growth Report
- Keyword Research, NLP and Search Intent
- PageSpeed and Core Web Vitals
- Whole Website SEO Audit
- Organic Visibility Signals
- AI Summary and Execution Roadmap
- Combined Schema Validation and Schema Generator
- AI-estimated public traffic visibility
- Verified Google Search Console and GA4 dashboard
- Contact form with Resend and WhatsApp fallback

## Accuracy policy

- PageSpeed and CrUX results use Google APIs when available.
- GSC and GA4 values are shown only after the owner authorises read-only Google access.
- AI keyword and traffic values are clearly labelled estimates and use broad ranges.
- The website audit reports live crawl evidence, exact affected URLs, robots/sitemap links, missing-alt image URLs, broken links, Open Graph preview, RDAP age, optional Open PageRank, and Common Crawl presence.
- Common Crawl URL samples are never presented as backlinks.

## Deploy

1. Extract the ZIP.
2. Upload the **contents** of this folder directly to the root of a GitHub repository.
3. Import that repository into Vercel.
4. Use Framework Preset **Other**.
5. Leave Build Command and Output Directory empty.
6. Add the environment variables from `.env.example`.
7. Deploy and open `/deployment-check.html`.

See `DEPLOY-ON-VERCEL-HOBBY.md` and `API-KEY-SETUP.md` for details.
