# Deploy Pajee SEO V11 on Vercel

## GitHub root

Extract the GitHub-root ZIP and upload its contents directly to the repository root. Do not upload an extra outer folder.

The repository root must contain:

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

## Vercel project settings

```text
Framework Preset: Other
Root Directory: blank
Build Command: blank
Output Directory: blank
```

## Environment variables

Copy the variables from `API-KEY-SETUP.md`. Ensure the OAuth callback uses the live project domain:

```env
GOOGLE_REDIRECT_URI=https://YOUR-LIVE-DOMAIN/api/google/callback
```

## Deploy cleanly

1. Commit the complete replacement to GitHub.
2. Open the latest deployment in Vercel.
3. Choose Redeploy.
4. Disable existing build cache for the replacement deployment.
5. Wait for Ready status.

## Production checks

Open:

```text
/deployment-check.html
/api/router?action=health
```

Then test:

- PageSpeed mobile and desktop tabs
- AI Growth Roadmap
- Complete SEO Growth Report
- Google report GSC and GA4 tabs
- Backlink discovery and CSV import
- Contact form

The included QA used controlled API-shaped test responses. Live API output still depends on keys, quotas, OAuth permissions, the connected properties and the target website response.
