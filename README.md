# Pajee SEO V9 — Production Website

This is the GitHub/Vercel root folder for the Pajee SEO multi-page website and SEO reporting tools.

## Deployment

1. Upload the **contents of this folder** to the repository root. `index.html`, `vercel.json`, `api/`, `lib/`, `assets/`, `services/`, `tools/`, `results/`, and `reports/` must appear directly at the root.
2. Import the repository in Vercel using Framework Preset **Other**.
3. Leave Root Directory, Build Command and Output Directory blank/default.
4. Add the environment variables listed in `API-KEY-SETUP-V9.md`.
5. Deploy, then open `/deployment-check.html`.

## Architecture

- Static responsive multi-page frontend.
- Three Vercel Serverless Functions, within the Hobby-plan limit:
  - `api/router.js`
  - `api/google/auth.js`
  - `api/google/callback.js`
- All non-OAuth backend actions are consolidated behind `api/router.js`.

## Accuracy policy

- Verified GSC/GA4 metrics are labelled separately from public or AI estimates.
- INP is shown only when real CrUX field data is returned.
- Backlink discovery is labelled as a verified public sample, not a complete Google backlink index.
- No fabricated rankings, traffic, reviews, ratings, revenue, or backlink totals are generated.
