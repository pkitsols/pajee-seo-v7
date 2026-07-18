# Vercel Environment Variables — Pajee SEO V10

Add these under **Vercel → Project → Settings → Environment Variables** for Production and Preview.

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash

GOOGLE_PAGESPEED_API_KEY=
GOOGLE_CRUX_API_KEY=
OPENPAGERANK_API_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://YOUR-PROJECT.vercel.app/api/google/callback
SESSION_SECRET=replace-with-a-long-random-secret

RESEND_API_KEY=
CONTACT_FROM_EMAIL=Pajee SEO <onboarding@resend.dev>
CONTACT_TO_EMAIL=pkitsol@gmail.com
```

## Gemini model

Use exactly:

```env
GEMINI_MODEL=gemini-3.5-flash
```

Do not use `gemini-3.1-flash`, `gemini-2.5-flash-lite`, or a value containing `models/`. The backend also enforces `gemini-3.5-flash`, so a stale Vercel model variable cannot make the backlink tool call the invalid model.

## Google OAuth

Add this exact Authorized Redirect URI in Google Cloud:

```text
https://YOUR-PROJECT.vercel.app/api/google/callback
```

Set the same URL as `GOOGLE_REDIRECT_URI`. The website requests read-only Search Console and Analytics access.

## Resend testing

`onboarding@resend.dev` is suitable only for Resend's permitted testing flow. After verifying `pajeeseo.pk`, use a sender on that domain.
