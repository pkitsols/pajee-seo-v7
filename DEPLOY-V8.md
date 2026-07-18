# Deploy Pajee SEO V8 on GitHub and Vercel Hobby

## 1. Upload the correct root

Extract the root ZIP. Upload the **contents inside the ZIP** directly to the GitHub repository root.

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
contact/
```

Do not upload an extra outer folder around these files.

## 2. Vercel project settings

Use:

```text
Framework Preset: Other
Root Directory: blank
Build Command: blank
Output Directory: blank
```

This package uses three Vercel Functions and remains below the Hobby-plan limit.

## 3. Environment variables

Add these in Vercel Project Settings → Environment Variables for Production and Preview:

```text
GEMINI_API_KEY
GEMINI_MODEL
GOOGLE_PAGESPEED_API_KEY
GOOGLE_CRUX_API_KEY
OPENPAGERANK_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
SESSION_SECRET
RESEND_API_KEY
CONTACT_FROM_EMAIL
CONTACT_TO_EMAIL
```

Recommended temporary values while using the Vercel domain:

```text
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_REDIRECT_URI=https://YOUR-PROJECT.vercel.app/api/google/callback
CONTACT_FROM_EMAIL=Pajee SEO <onboarding@resend.dev>
CONTACT_TO_EMAIL=pkitsol@gmail.com
```

Never commit actual secret values to GitHub.

## 4. Google OAuth settings

The exact routes in this package are:

```text
/api/google/auth
/api/google/callback
```

In Google Cloud OAuth Client settings:

### Authorized JavaScript origin

```text
https://YOUR-PROJECT.vercel.app
```

### Authorized redirect URI

```text
https://YOUR-PROJECT.vercel.app/api/google/callback
```

The Vercel `GOOGLE_REDIRECT_URI` value and Google Cloud Authorized Redirect URI must match exactly.

Enable:

- Google Search Console API
- Google Analytics Data API
- Google Analytics Admin API

If the OAuth app is in Testing status, add the Google account used for testing to Test Users.

## 5. Redeploy

After adding or changing environment variables, redeploy the latest commit. Environment-variable changes do not alter a deployment that was already built.

## 6. Live verification order

Open:

```text
https://YOUR-PROJECT.vercel.app/api/router?action=health
```

Then test:

```text
https://YOUR-PROJECT.vercel.app/api/google/auth
https://YOUR-PROJECT.vercel.app/tools/pagespeed-core-web-vitals/
https://YOUR-PROJECT.vercel.app/tools/website-seo-audit/
https://YOUR-PROJECT.vercel.app/tools/schema-intelligence/
https://YOUR-PROJECT.vercel.app/tools/organic-visibility/
https://YOUR-PROJECT.vercel.app/tools/traffic-analytics/
```

For the callback route, opening it without a Google authorization code should show a controlled missing-code error—not a Vercel 404.

## 7. Social links and portfolio evidence

Official-style SVG icons are included locally. Replace placeholder `href="#"` social links with the actual Pajee SEO Facebook, LinkedIn, and X URLs.

Portfolio result tables intentionally contain evidence placeholders. Add only real, client-approved GSC, GA4, ranking, campaign, or project proof.
