(() => {
  'use strict';

  const discoverForm = document.querySelector('#backlink-discover-form');
  const importForm = document.querySelector('#backlink-import-form');
  const fileInput = document.querySelector('#backlink-csv');
  const status = document.querySelector('#backlink-import-status');

  function rootDomain(hostname = '') {
    const clean = String(hostname).toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
    if (clean.length <= 2) return clean.join('.');
    const publicSuffixPairs = new Set(['co.uk', 'org.uk', 'com.au', 'co.nz', 'com.pk', 'org.pk', 'net.pk', 'co.in']);
    const suffix = clean.slice(-2).join('.');
    return publicSuffixPairs.has(suffix) ? clean.slice(-3).join('.') : clean.slice(-2).join('.');
  }

  function detectDelimiter(text = '') {
    const sample = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()).slice(0, 8);
    const delimiters = [',', ';', '\t'];
    const score = (delimiter) => sample.reduce((total, line) => {
      let count = 0;
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
          if (quoted && line[index + 1] === '"') index += 1;
          else quoted = !quoted;
        } else if (!quoted && char === delimiter) count += 1;
      }
      return total + count;
    }, 0);
    return delimiters.sort((a, b) => score(b) - score(a))[0] || ',';
  }

  function parseDelimited(text = '', delimiter = ',') {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text).replace(/^\uFEFF/, '');

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (!quoted && char === delimiter) {
        row.push(cell.trim());
        cell = '';
      } else if (!quoted && (char === '\n' || char === '\r')) {
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        row.push(cell.trim());
        if (row.some((value) => value !== '')) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }

    row.push(cell.trim());
    if (row.some((value) => value !== '')) rows.push(row);
    return rows;
  }

  function cleanCell(value = '') {
    return String(value)
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\u2060]/g, '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim();
  }

  function normaliseUrl(value = '') {
    let raw = cleanCell(value);
    if (!raw || /^(?:n\/?a|null|undefined|-|—)$/i.test(raw)) return '';
    if (raw.startsWith('//')) raw = `https:${raw}`;
    if (!/^https?:\/\//i.test(raw) && /^(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(raw)) {
      raw = `https://${raw}`;
    }
    try {
      const url = new URL(raw);
      if (!/^https?:$/i.test(url.protocol)) return '';
      url.hash = '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function normaliseDomain(value = '') {
    const raw = cleanCell(value).toLowerCase();
    if (!raw || /[\s@]/.test(raw)) return '';
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const domain = rootDomain(url.hostname);
      return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : '';
    } catch {
      return '';
    }
  }

  function findHeaderIndex(headers, patterns) {
    return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  }

  function parseImport(text, targetUrl, filename = '') {
    const delimiter = detectDelimiter(text);
    const rows = parseDelimited(text, delimiter);
    const targetRoot = rootDomain(new URL(targetUrl).hostname);
    const headers = (rows[0] || []).map((value) => cleanCell(value).toLowerCase());
    const hasHeader = headers.some((header) => /^(?:linking page|source page|source url|backlink|linking url|referring page|from page|site|linking site|referring domain|domain|target page|target url|linked page|destination|last crawled|links?|pages?)$/i.test(header));
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const sourceIndex = findHeaderIndex(headers, [
      /linking page/, /source page/, /source url/, /backlink/, /linking url/, /referring page/, /from page/
    ]);
    const domainIndex = findHeaderIndex(headers, [
      /^site$/, /linking site/, /referring domain/, /^domain$/
    ]);
    const targetIndex = findHeaderIndex(headers, [
      /target page/, /target url/, /linked page/, /destination/
    ]);

    const sourceUrls = [];
    const domains = [];
    const targetUrls = [];
    let ignored = 0;

    const addUrl = (raw, preferredType = '') => {
      const url = normaliseUrl(raw);
      if (!url) return false;
      const domain = rootDomain(new URL(url).hostname);
      if (domain === targetRoot || preferredType === 'target') targetUrls.push(url);
      else sourceUrls.push(url);
      return true;
    };

    for (const row of dataRows) {
      const cells = row.map(cleanCell).filter(Boolean);
      if (!cells.length) continue;
      let matched = false;

      if (sourceIndex >= 0 && row[sourceIndex] !== undefined) {
        matched = addUrl(row[sourceIndex], 'source') || matched;
      }
      if (targetIndex >= 0 && row[targetIndex] !== undefined) {
        matched = addUrl(row[targetIndex], 'target') || matched;
      }
      if (domainIndex >= 0 && row[domainIndex] !== undefined) {
        const domain = normaliseDomain(row[domainIndex]);
        if (domain && domain !== targetRoot) {
          domains.push(domain);
          matched = true;
        }
      }

      if (!matched) {
        for (const cell of cells) {
          const url = normaliseUrl(cell);
          if (url) {
            const domain = rootDomain(new URL(url).hostname);
            if (domain === targetRoot) targetUrls.push(url);
            else sourceUrls.push(url);
            matched = true;
            continue;
          }
          const domain = normaliseDomain(cell);
          if (domain && domain !== targetRoot && !/^\d+(?:\.\d+)?$/.test(cell)) {
            domains.push(domain);
            matched = true;
          }
        }
      }

      if (!matched) ignored += 1;
    }

    const unique = (items, limit) => [...new Set(items)].slice(0, limit);
    const result = {
      filename,
      delimiter: delimiter === '\t' ? 'tab' : delimiter === ';' ? 'semicolon' : 'comma',
      sourceUrls: unique(sourceUrls, 5000),
      domains: unique(domains, 2000),
      targetUrls: unique(targetUrls, 5000),
      ignoredRows: ignored,
      totalRows: dataRows.length
    };

    if (result.sourceUrls.length) result.kind = 'source-pages';
    else if (result.domains.length) result.kind = 'referring-domains';
    else if (result.targetUrls.length) result.kind = 'target-pages-only';
    else result.kind = 'unrecognised';
    return result;
  }

  function setStatus(message, type = 'blue') {
    if (!status) return;
    status.innerHTML = message ? `<div class="notice notice-${type}">${message}</div>` : '';
  }

  function summaryText(parsed) {
    return `${parsed.sourceUrls.length} source-page URLs, ${parsed.domains.length} referring domains and ${parsed.targetUrls.length} target URLs detected from ${parsed.totalRows} rows.`;
  }

  if (discoverForm) {
    discoverForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const url = new FormData(discoverForm).get('url');
      location.href = `/results/backlink-authority/?mode=discover&url=${encodeURIComponent(url)}`;
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      const targetUrl = importForm ? new FormData(importForm).get('url') : '';
      if (!file || !targetUrl) {
        setStatus('Enter the website URL, then choose the Search Console export.', 'blue');
        return;
      }
      try {
        const parsed = parseImport(await file.text(), targetUrl, file.name);
        const type = parsed.kind === 'unrecognised' || parsed.kind === 'target-pages-only' ? 'red' : 'blue';
        setStatus(summaryText(parsed), type);
      } catch (error) {
        setStatus(`The file could not be read: ${error.message}`, 'red');
      }
    });
  }

  if (importForm) {
    importForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const file = fileInput?.files?.[0];
      const url = String(new FormData(importForm).get('url') || '').trim();
      if (!file) {
        setStatus('Choose a CSV or TSV export first.', 'red');
        return;
      }

      try {
        const parsed = parseImport(await file.text(), url, file.name);
        if (!parsed.sourceUrls.length && !parsed.domains.length) {
          const message = parsed.targetUrls.length
            ? 'This appears to be the “Top linked pages” export, which contains your own target URLs rather than external backlink sources. Upload “Latest links”, “More sample links”, or “Top linking sites”.'
            : 'No source-page URLs or referring domains were detected. Upload a Google Search Console Links CSV/TSV or a plain list of referring URLs/domains.';
          setStatus(message, 'red');
          return;
        }

        sessionStorage.setItem('pajee-backlink-import', JSON.stringify({
          url,
          sourceUrls: parsed.sourceUrls,
          domains: parsed.domains,
          targetUrls: parsed.targetUrls,
          importSummary: parsed,
          rows: parsed.sourceUrls
        }));
        location.href = '/results/backlink-authority/?mode=import';
      } catch (error) {
        setStatus(`The file could not be imported: ${error.message}`, 'red');
      }
    });
  }

  window.PajeeBacklinkImport = {
    rootDomain,
    detectDelimiter,
    parseDelimited,
    normaliseUrl,
    normaliseDomain,
    parseImport
  };
})();
