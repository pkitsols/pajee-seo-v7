# Pajee SEO Tool Matrix

| Tool | Route | Data source | Key required | Result flow |
|---|---|---|---|---|
| Complete SEO Growth Report | `/tools/seo-growth-report/` | Keyword AI + PageSpeed + crawler + visibility AI + roadmap AI | Gemini required; PageSpeed key recommended | Dedicated result page |
| Keyword Research, NLP & Intent | `/tools/keyword-intelligence/` | Gemini webpage and keyword analysis | Gemini required | Dedicated result page |
| PageSpeed & Core Web Vitals | `/tools/pagespeed-core-web-vitals/` | Google PageSpeed Insights and optional CrUX | PageSpeed key recommended; CrUX key for field data | Dedicated result page |
| Whole Website SEO Audit | `/tools/website-seo-audit/` | Server-side crawler, robots, sitemap, link checks, RDAP, Common Crawl, optional OpenPageRank | No key for core crawl; OpenPageRank optional | Dedicated result page |
| Organic Visibility Signals | `/tools/organic-visibility/` | Public webpage signals + Gemini estimate | Gemini required | Dedicated result page |
| AI Summary & Execution Roadmap | `/tools/ai-roadmap/` | Public page evidence + Gemini | Gemini required | Dedicated result page |
| Schema Intelligence | `/tools/schema-intelligence/` | JSON-LD/Microdata/RDFa detection + intent analysis + schema generation | Core checks work without AI; Gemini required for advanced intent/generation | Combined validation and generation page |
| Public Traffic Estimate | `/tools/traffic-analytics/` | Public signals + Gemini broad estimate | Gemini required | Dedicated result page |
| Verified GSC & GA4 Dashboard | `/dashboard/` | Google Search Console and Google Analytics Data APIs | Google OAuth credentials required | Interactive dashboard |
| Contact Form | `/contact/` | Resend email API with WhatsApp fallback | Resend key required for email | Inline success/fallback |

## Data-label policy

- **AI Estimated**: broad ranges and recommendations; never presented as official Google Ads, GA4 or GSC data.
- **Public Signal**: crawl, HTML, robots, sitemap, performance, RDAP, Common Crawl or OpenPageRank data.
- **Verified Google Data**: shown only after the property owner connects GSC or GA4 with read-only OAuth access.
