# Vercel Environment Variables — Pajee SEO V9

Add these in **Vercel → Project → Settings → Environment Variables** for Production and Preview.

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash

GOOGLE_PAGESPEED_API_KEY=
GOOGLE_CRUX_API_KEY=
OPENPAGERANK_API_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://YOUR-PROJECT.vercel.app/api/google/callback
SESSION_SECRET=

RESEND_API_KEY=
CONTACT_FROM_EMAIL=Pajee SEO <onboarding@resend.dev>
CONTACT_TO_EMAIL=pkitsol@gmail.com

# Optional future verified Bing link mode
BING_WEBMASTER_API_KEY=
```

## Google OAuth

In Google Cloud, add the exact production callback as an Authorized Redirect URI:

```text
https://YOUR-PROJECT.vercel.app/api/google/callback
```

The website requests read-only Search Console and Analytics access. After changing variables, create a fresh deployment.

## Temporary email testing

`onboarding@resend.dev` can be used only under Resend's testing rules. When `pajeeseo.pk` is verified in Resend, change the sender to:

```env
CONTACT_FROM_EMAIL=Pajee SEO <website@pajeeseo.pk>
```
