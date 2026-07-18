# Deploy Pajee SEO V9 on GitHub and Vercel

## 1. GitHub root

Upload the files **inside** this folder directly to the repository root. Do not upload an extra outer folder.

The root should contain:

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

## 2. Vercel project

- Framework Preset: `Other`
- Root Directory: blank
- Build Command: blank
- Output Directory: blank

## 3. Environment variables

Use `API-KEY-SETUP-V9.md`. After adding or changing variables, redeploy without relying on an old deployment.

## 4. Post-deployment tests

Open these in order:

```text
https://YOUR-PROJECT.vercel.app/deployment-check.html
https://YOUR-PROJECT.vercel.app/api/router?action=health
https://YOUR-PROJECT.vercel.app/api/google/auth
```

Then test:

1. Contact form and email delivery.
2. Keyword Intelligence and AI Roadmap.
3. PageSpeed mobile and desktop.
4. Whole Website Audit with a small crawl first.
5. Schema Intelligence single-page mode, then whole-site mode.
6. Organic Search / GA4 connection.
7. Backlink tool public discovery and CSV import.

## 5. Google callback

The callback path in this build is:

```text
/api/google/callback
```

The value in Vercel and Google Cloud must match exactly, including the hostname and path.
