# Deployment Guide — GitHub and Vercel Hobby

## 1. GitHub repository root

Upload the contents of this folder directly to the repository root. The repository root must contain:

- `index.html`
- `vercel.json`
- `package.json`
- `api/`
- `lib/`
- `services/`
- `tools/`
- `results/`
- `reports/`

Do not place these files inside another outer folder.

## 2. Vercel project settings

- Framework Preset: Other
- Root Directory: blank
- Build Command: blank
- Output Directory: blank

## 3. Environment variables

Copy the variable names from `.env.example` into Vercel Project Settings → Environment Variables. Select Production and Preview. Never commit real values to GitHub.

The exact callback value must use the live Vercel project domain:

`GOOGLE_REDIRECT_URI=https://YOUR-VERCEL-PROJECT.vercel.app/api/google/callback`

## 4. Google Cloud OAuth client

Authorized JavaScript origin:

`https://YOUR-VERCEL-PROJECT.vercel.app`

Authorized redirect URI:

`https://YOUR-VERCEL-PROJECT.vercel.app/api/google/callback`

Enable:

- Google Search Console API
- Google Analytics Data API
- Google Analytics Admin API

Use read-only scopes. If the OAuth app is in Testing mode, add the testing Google accounts as Test Users.

## 5. Deploy and verify

Redeploy after adding or changing environment variables.

Open:

- `/deployment-check.html`
- `/api/router?action=health`
- `/api/google/auth`
- `/api/google/callback` — without a Google code this should return a controlled message, not Vercel 404.

Then test:

- Contact form
- PageSpeed mobile and desktop
- Schema analysis and generation
- Website audit
- Complete growth report
- Google Search Console report
- GA4 report

## 6. Temporary Resend setup

For testing before domain verification:

- `CONTACT_FROM_EMAIL=Pajee SEO <onboarding@resend.dev>`
- `CONTACT_TO_EMAIL=pkitsol@gmail.com`

The Resend account email must be allowed to receive test messages. Later, verify `pajeeseo.pk` and change the sender to an address on that domain.
