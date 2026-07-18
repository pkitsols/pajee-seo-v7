# Deploy Pajee SEO V10 on Vercel

## 1. Replace the repository

Remove the previous website files, then upload the **contents** of the V10 root ZIP directly to the GitHub repository root. Do not upload an additional outer folder.

## 2. Confirm the root structure

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

## 3. Vercel project settings

```text
Framework Preset: Other
Root Directory: blank
Build Command: blank
Output Directory: blank
```

## 4. Environment variables

Add the variables in `API-KEY-SETUP.md`. Confirm:

```env
GEMINI_MODEL=gemini-3.5-flash
GOOGLE_REDIRECT_URI=https://YOUR-PROJECT.vercel.app/api/google/callback
```

## 5. Fresh deployment

Redeploy the latest GitHub commit without reusing the previous build cache.

## 6. Production checks

Open:

```text
https://YOUR-PROJECT.vercel.app/deployment-check.html
https://YOUR-PROJECT.vercel.app/api/router?action=health
```

The health response should report Gemini as configured and show `gemini-3.5-flash`.

Then test:

1. Complete SEO Growth Report.
2. PageSpeed mobile and desktop modes.
3. Whole Website Audit with a small URL limit first.
4. Backlink Intelligence public discovery.
5. Google connection and both GSC/GA4 report choices.
6. Contact-form email delivery.

Real production responses depend on live API keys, quotas, OAuth permissions and the target website's availability.
