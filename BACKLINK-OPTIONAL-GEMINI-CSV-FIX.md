# Backlink Optional Gemini and CSV Import Fix

## Problem 1: Gemini quota stopped the backlink tool

Gemini is now optional. When enabled, it only expands search queries. All backlink candidates still require live HTML verification.

Automatic fallback is used for:

- `429 RESOURCE_EXHAUSTED` or quota exhaustion
- Missing or invalid API key
- Permission failure
- Model unavailable/not found
- Timeout/network error
- Temporary Gemini service error

## Problem 2: Search Console sheet showed “No backlink candidate URLs were found”

The importer now detects and supports:

- Latest links source-page URLs
- More sample links source-page URLs
- Top linking sites domain-only exports
- Comma CSV
- Semicolon CSV
- TSV
- Plain URL/domain lists
- UTF-8 BOM and quoted cells

When a Top linking sites file contains only domains, the backend runs domain-scoped public searches and verifies resulting pages. If a Top linked pages file is uploaded, the form explains that it contains destination URLs and asks for the correct export instead of sending an empty request.
