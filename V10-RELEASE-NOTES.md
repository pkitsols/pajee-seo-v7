# Pajee SEO V10.1 Release Notes

## Backlink quota fix

- Removed the Gemini request from automatic backlink discovery.
- Added quota-independent public search candidate discovery through DuckDuckGo and Bing result pages.
- Kept live HTML verification: only source pages that contain an actual link to the target domain are counted as verified.
- Added graceful partial/empty reports when public discovery sources return no candidates.
- Kept Google Search Console Links CSV import and 25/50/100-row pagination.
- Pajee Authority Signal now returns 0 when there is no verified backlink evidence instead of creating a baseline score.
- Added clear discovery-source and warning messages in the report.

# Pajee SEO V10 — Requested Changes

This version replaces the previous surface-level update with a structural redesign focused only on the supplied requirements.

## Main changes

- Unique animated visual language for SEO, digital marketing, web development, UI/UX, branding and mobile-app cards.
- Rebuilt Services Hub and individual service pages with clearer proof, process, portfolio and conversion sections.
- Fixed mega-menu positioning so it remains inside the viewport.
- Added Backlink Intelligence to desktop, mobile and footer navigation.
- Added working Backlink Intelligence forms and report route.
- Removed Gemini from backlink discovery so Gemini quota and model availability cannot stop the Backlink Intelligence report.
- Rebuilt report hero styling for clear white text on a dark readable background.
- Added multiple chart types, compact evidence sections, load-more controls and pagination structures.
- Added clearer mobile and desktop PageSpeed screenshot handling, real CrUX INP rules and LCP-image evidence.
- Expanded audit visualisation, page inventory, page priorities and image evidence.
- Preserved separate public-estimate and verified Google reporting paths.
- Expanded Schema Intelligence to single-page and whole-website modes with page-wise recommendations and generation.
- Corrected footer social-icon alignment and hover visibility.

## V10.2 — Optional Gemini and Search Console import resilience

- Gemini is optional for backlink query planning.
- Quota/model/key/permission/timeout failures automatically fall back to deterministic public-search queries.
- Search Console imports support comma CSV, semicolon CSV, TSV and plain URL/domain lists.
- Top linking sites domain-only exports now run domain-scoped discovery.
- Top linked pages exports are detected before sending an empty backlink request.
