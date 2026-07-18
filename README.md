# Pajee SEO V10.2 — Backlink Resilience Update

This is the complete GitHub/Vercel root package for Pajee SEO.

## V10.2 changes

- Backlink discovery may use Gemini 3.5 Flash only as optional search-query assistance.
- If Gemini is disabled, missing, out of quota, temporarily unavailable, or returns a model error, backlink discovery automatically continues with deterministic public-search queries.
- The backlink report never counts an AI suggestion as a backlink; candidate pages are fetched and their live HTML anchors are verified.
- Search Console imports now support comma CSV, semicolon CSV, TSV, plain URL lists, Latest links, More sample links, and Top linking sites exports.
- Top linking sites domain-only exports are converted into domain-scoped public discovery instead of failing with “No backlink candidate URLs were found.”
- Top linked pages exports are detected and explained because they contain the audited site's target URLs rather than external source pages.

## Deploy

Upload the **contents of this folder** directly to the repository root:

```text
index.html
vercel.json
package.json
api/
lib/
assets/
services/
tools/
results/
reports/
```

Read `DEPLOY-V10.md`, `API-KEY-SETUP.md`, and `BACKLINK-OPTIONAL-GEMINI-CSV-FIX.md` before deployment.

## Accuracy policy

- The backlink report is a verified public sample or imported evidence set, not Google's complete backlink index.
- The Pajee Authority Signal is a Pajee SEO analytical score, not Google PageRank or Ahrefs DR.
- Gemini may improve candidate-search queries, but only links confirmed in fetched HTML are counted.
