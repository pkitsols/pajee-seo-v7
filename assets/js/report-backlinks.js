(async () => {
  'use strict';

  const U = ReportUI;
  const params = U.params();
  const root = document.querySelector('#backlink-report');
  let url = params.url || '';
  const mode = params.mode || 'discover';
  let importedRows = [];
  let importedDomains = [];
  let importSummary = null;

  if (mode === 'import') {
    try {
      const stored = JSON.parse(sessionStorage.getItem('pajee-backlink-import') || '{}');
      url = stored.url || '';
      importedRows = Array.isArray(stored.sourceUrls)
        ? stored.sourceUrls
        : Array.isArray(stored.rows)
          ? stored.rows
          : [];
      importedDomains = Array.isArray(stored.domains) ? stored.domains : [];
      importSummary = stored.importSummary || null;
    } catch {
      importedRows = [];
      importedDomains = [];
    }
  }

  if (!url) {
    U.statusMessage(root, 'Target website was not found. Return to the backlink tool.', 'red');
    return;
  }

  root.innerHTML = U.loading('Building backlink intelligence…', [
    'Using optional Gemini assistance or automatic public-search fallback',
    'Reading imported source URLs or referring domains',
    'Fetching candidate pages and verifying live anchors',
    'Grouping referring domains and target pages',
    'Calculating the Pajee Authority Signal'
  ]);

  function paginatedTable(items, columns, initialSize = 25) {
    const id = `tbl-${Math.random().toString(36).slice(2)}`;
    const state = { page: 1, size: initialSize };

    setTimeout(() => {
      const element = document.getElementById(id);
      if (!element) return;

      const render = () => {
        const totalPages = Math.max(1, Math.ceil(items.length / state.size));
        state.page = Math.min(state.page, totalPages);
        const start = (state.page - 1) * state.size;
        const slice = items.slice(start, start + state.size);
        const table = slice.length
          ? U.pageTable(slice, columns)
          : '<div class="v10-empty-state"><h3>No rows available</h3><p>No verified evidence is available for this section yet.</p></div>';

        element.innerHTML = `${table}
          <div class="v10-pagination">
            <span class="state">Page ${state.page} of ${totalPages} · ${items.length} rows</span>
            <div class="controls">
              <select data-size aria-label="Rows per page">
                <option value="25">25 rows</option>
                <option value="50">50 rows</option>
                <option value="100">100 rows</option>
              </select>
              <button type="button" data-prev ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
              <button type="button" disabled>${state.page}</button>
              <button type="button" data-next ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
            </div>
          </div>`;

        element.querySelector('[data-size]').value = String(state.size);
        element.querySelector('[data-size]').addEventListener('change', (event) => {
          state.size = Number(event.target.value);
          state.page = 1;
          render();
        });
        element.querySelector('[data-prev]')?.addEventListener('click', () => {
          state.page = Math.max(1, state.page - 1);
          render();
        });
        element.querySelector('[data-next]')?.addEventListener('click', () => {
          state.page = Math.min(totalPages, state.page + 1);
          render();
        });
      };

      render();
    }, 0);

    return `<div id="${id}"></div>`;
  }

  function warningPanel(warnings) {
    if (!Array.isArray(warnings) || !warnings.length) return '';
    return `<div class="v10-backlink-warning" role="status">
      <strong>Discovery note</strong>
      <ul>${warnings.map((warning) => `<li>${U.esc(warning)}</li>`).join('')}</ul>
      <a class="btn btn-outline btn-sm" href="/tools/backlink-authority/#google-links-import">Import another Google Links file</a>
    </div>`;
  }

  function dedupeLinks(items) {
    const seen = new Set();
    return (items || []).filter((item) => {
      const key = `${item.sourceUrl || ''}|${item.targetUrl || ''}|${item.anchor || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function combineResponses(responses, totalCandidates = null) {
    const valid = responses.filter(Boolean);
    if (!valid.length) return null;
    const links = dedupeLinks(valid.flatMap((item) => item.links || []));
    const liveLinks = links.filter((link) => link.live && !link.noLinkFound);
    const warnings = [...new Set(valid.flatMap((item) => item.warnings || []))];
    const sources = [...new Set(valid.flatMap((item) => item.discoverySources || []))];
    const domainsUsed = [...new Set(valid.flatMap((item) => item.importedDomainsUsed || []))];
    const aiResponse = valid.find((item) => item.aiAssist?.status === 'used')
      || valid.find((item) => item.aiAssist?.status === 'fallback')
      || valid[0];

    return {
      ...valid[0],
      links,
      warnings,
      discoverySources: sources,
      importedDomainsUsed: domainsUsed,
      aiAssist: aiResponse?.aiAssist || valid[0].aiAssist,
      summary: {
        ...(valid[0].summary || {}),
        candidates: totalCandidates ?? links.length,
        verifiedLive: liveLinks.length,
        referringDomains: new Set(liveLinks.map((link) => link.sourceDomain)).size,
        followLinks: liveLinks.filter((link) => link.follow).length,
        nofollowLinks: liveLinks.filter((link) => !link.follow).length,
        unverified: links.filter((link) => !link.live).length
      }
    };
  }

  async function requestBatches(items, size, payload) {
    const responses = [];
    for (let index = 0; index < items.length; index += size) {
      responses.push(await U.api('backlink-intelligence', {
        method: 'POST',
        body: payload(items.slice(index, index + size))
      }));
    }
    return responses;
  }

  try {
    let data;

    if (mode === 'import') {
      const responses = [];

      if (importedRows.length) {
        responses.push(...await requestBatches(importedRows, 24, (batch) => ({
          mode: 'verify',
          url,
          urls: batch
        })));
      }

      if (importedDomains.length) {
        responses.push(...await requestBatches(importedDomains, 8, (batch) => ({
          mode: 'domain-discover',
          url,
          domains: batch
        })));
      }

      if (!responses.length) {
        responses.push(await U.api('backlink-intelligence', {
          method: 'POST',
          body: { mode: 'verify', url, urls: [], domains: [] }
        }));
      }

      data = combineResponses(responses, importedRows.length + importedDomains.length);
      if (importSummary) data.importSummary = importSummary;
    } else {
      data = await U.api('backlink-intelligence', {
        method: 'POST',
        body: { mode: 'discover', url }
      });
    }

    if (!data) throw new Error('The backlink report did not return a usable response.');

    const liveLinks = (data.links || []).filter((link) => link.live && !link.noLinkFound);
    const domains = Object.entries(liveLinks.reduce((accumulator, link) => {
      accumulator[link.sourceDomain] = (accumulator[link.sourceDomain] || 0) + 1;
      return accumulator;
    }, {}))
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => ({ domain, count }));

    const targetPages = Object.entries(liveLinks.reduce((accumulator, link) => {
      accumulator[link.targetUrl] = (accumulator[link.targetUrl] || 0) + 1;
      return accumulator;
    }, {}))
      .sort((a, b) => b[1] - a[1])
      .map(([target, count]) => ({ target, count }));

    const logo = document.querySelector('[data-site-logo]');
    if (logo) {
      logo.innerHTML = data.site?.favicon
        ? `<img src="${U.esc(data.site.favicon)}" alt="">`
        : U.esc((data.site?.name || 'P')[0]);
    }

    const subtitle = document.querySelector('[data-report-subtitle]');
    if (subtitle) {
      subtitle.textContent = `${data.site?.name || new URL(url).hostname} · ${data.summary?.verifiedLive || 0} live links · ${data.summary?.referringDomains || 0} referring domains`;
    }

    const donut = PajeeCharts.donut([
      { label: 'Follow', value: data.summary?.followLinks || 0 },
      { label: 'Nofollow / sponsored / UGC', value: data.summary?.nofollowLinks || 0 },
      { label: 'Not verified', value: data.summary?.unverified || 0 }
    ], { centerLabel: 'Candidates' });

    const domainBars = domains.length
      ? PajeeCharts.barChart(domains.slice(0, 12).map((item) => ({ label: item.domain, value: item.count })), { height: 330, horizontal: true })
      : '<div class="v10-empty-chart">No verified referring domains yet.</div>';

    const targetBars = targetPages.length
      ? PajeeCharts.barChart(targetPages.slice(0, 10).map((item) => ({ label: item.target, value: item.count })), { height: 330, horizontal: true })
      : '<div class="v10-empty-chart">No verified target-page distribution yet.</div>';

    const sourceDetails = Array.isArray(data.discoverySources) && data.discoverySources.length
      ? `Sources used: ${data.discoverySources.map(U.esc).join(', ')}.`
      : mode === 'import'
        ? 'Evidence came from the uploaded Search Console file and live public verification.'
        : 'Public discovery sources did not return candidate pages during this scan.';

    let aiDetails = 'Gemini was not needed for this imported evidence check.';
    if (mode === 'discover') {
      aiDetails = data.aiAssist?.status === 'used'
        ? `Gemini ${U.esc(data.aiAssist.model || 'assistance')} expanded the search-query plan. Every candidate was still verified in live HTML.`
        : 'Gemini was unavailable, disabled or out of quota, so the report automatically used public-search fallback queries without stopping.';
    }

    const importDetails = data.importSummary
      ? `<div class="v10-source-note"><strong>Imported file:</strong> ${U.esc(data.importSummary.filename || 'Search Console export')} · ${U.esc(data.importSummary.sourceUrls?.length || 0)} source URLs · ${U.esc(data.importSummary.domains?.length || 0)} referring domains · ${U.esc(data.importSummary.targetUrls?.length || 0)} target URLs detected.</div>`
      : '';

    root.innerHTML = `
      <section class="report-section" id="backlink-overview">
        <div class="report-section-head">
          <div>
            ${U.tag(data.sourceLabel, data.aiAssist?.status === 'used' ? 'ai' : 'public')}
            <h2>Backlink evidence overview</h2>
            <p>${U.esc(data.disclaimer)}</p>
          </div>
        </div>
        ${warningPanel(data.warnings)}
        ${importDetails}
        <div class="metric-grid">
          ${U.metric('Candidates checked', data.summary?.candidates || 0, 'warn')}
          ${U.metric('Verified live links', data.summary?.verifiedLive || 0, 'good')}
          ${U.metric('Referring domains', data.summary?.referringDomains || 0, 'good')}
          ${U.metric('Pajee Authority Signal', `${data.authority?.score || 0}/100`, data.authority?.score >= 70 ? 'good' : data.authority?.score >= 40 ? 'warn' : 'poor')}
        </div>
        <div class="v10-chart-grid">
          <article class="v10-chart-card">
            <h3>Authority signal</h3>
            <div style="display:grid;place-items:center">${PajeeCharts.gauge(data.authority?.score || 0, { label: 'Pajee Authority' })}</div>
            <p>${U.esc(data.authority?.confidence || 'Insufficient evidence')} · OpenPageRank ${data.authority?.openPageRank ?? 'Unavailable'}</p>
          </article>
          <article class="v10-chart-card">
            <h3>Link attributes and verification</h3>
            ${donut}
          </article>
        </div>
        <div class="v10-source-note">
          ${U.esc(sourceDetails)} ${aiDetails} Pajee Authority Signal is not Google PageRank, Ahrefs DR, or a claim of Google's complete backlink index.
        </div>
      </section>

      <section class="report-section" id="referring-domains">
        <div class="report-section-head"><div><h2>Referring domains</h2><p>Unique external domains with a live link confirmed in fetched page HTML.</p></div></div>
        <div class="v10-chart-card">${domainBars}</div>
        ${paginatedTable(domains, [
          { label: 'Referring domain', key: 'domain' },
          { label: 'Verified links', key: 'count' }
        ])}
      </section>

      <section class="report-section" id="backlink-pages">
        <div class="report-section-head"><div><h2>Backlink pages</h2><p>Exact source pages, target pages, anchors, attributes and verification status.</p></div></div>
        ${paginatedTable(data.links || [], [
          { label: 'Source page', render: (row) => `<a href="${U.esc(row.sourceUrl)}" target="_blank" rel="noopener">${U.esc(row.sourceUrl)}</a>` },
          { label: 'Referring domain', key: 'sourceDomain' },
          { label: 'Target URL', render: (row) => row.targetUrl ? `<a href="${U.esc(row.targetUrl)}" target="_blank" rel="noopener">${U.esc(row.targetUrl)}</a>` : '—' },
          { label: 'Anchor', key: 'anchor' },
          { label: 'Attribute', render: (row) => row.live ? (row.follow ? 'Follow' : U.esc(row.rel || 'Nofollow')) : 'Not verified' },
          { label: 'Status', render: (row) => row.live ? 'Live link' : row.noLinkFound ? 'No link found' : U.esc(row.error || 'Unavailable') }
        ])}
      </section>

      <section class="report-section" id="target-pages">
        <div class="report-section-head"><div><h2>Target-page distribution</h2><p>Which pages receive the verified links in this report.</p></div></div>
        <div class="v10-chart-card">${targetBars}</div>
        ${paginatedTable(targetPages, [
          { label: 'Target URL', key: 'target' },
          { label: 'Verified backlinks', key: 'count' }
        ])}
      </section>

      <section class="report-section" id="recommendations">
        <div class="v10-priority-matrix">
          <article class="v10-priority-card high"><h3>Repair lost value</h3><p>Restore or redirect valuable linked target URLs that return errors.</p></article>
          <article class="v10-priority-card medium"><h3>Improve diversity</h3><p>Prioritise relevant new referring domains instead of repeated links from the same source.</p></article>
          <article class="v10-priority-card low"><h3>Strengthen destinations</h3><p>Build useful link-worthy pages around the site's commercial and topical priorities.</p></article>
        </div>
      </section>

      <section class="cta-band">
        <div><h2>Turn backlink evidence into an authority plan.</h2><p>We can review relevance, risk, lost links and content-led acquisition opportunities.</p></div>
        <a class="btn btn-light" href="/contact/#contact-form">Request a Link Strategy Consultation</a>
      </section>`;
  } catch (error) {
    U.statusMessage(root, error.message, 'red');
  }
})();
