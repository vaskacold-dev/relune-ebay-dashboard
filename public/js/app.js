// public/js/app.js
//
// All data here comes from /api/ebay-search, /api/ai-insight, and
// /api/sold-scraper (see netlify/functions/). No dummy or fake data
// is displayed as real results.

const state = {
  result: null, // response from /api/ebay-search
  ai: null,     // response from /api/ai-insight
  charts: {},   // Chart.js instances, destroyed before re-render
};

const qs = (id) => document.getElementById(id);
const fmtMoney = (v, currency = 'USD') =>
  v == null ? '-' : `${currency === 'USD' ? '$' : currency + ' '}${Number(v).toFixed(2)}`;

// ===================== SIDEBAR NAVIGATION =====================
function showPage(pageKey) {
  document.querySelectorAll('.nav-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.page === pageKey)
  );
  document.querySelectorAll('[data-content]').forEach((el) => {
    el.style.display = el.dataset.content === pageKey ? 'block' : 'none';
  });
  if (window.innerWidth <= 900) qs('sidebar').classList.remove('open');
  if (pageKey === 'saved') renderSavedList();
}

document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', () => showPage(el.dataset.page));
});

qs('menuToggle').addEventListener('click', () =>
  qs('sidebar').classList.toggle('open')
);

// Close sidebar when clicking outside on mobile
document.addEventListener('click', (e) => {
  if (window.innerWidth <= 900 && qs('sidebar').classList.contains('open')) {
    if (!qs('sidebar').contains(e.target) && e.target !== qs('menuToggle')) {
      qs('sidebar').classList.remove('open');
    }
  }
});

// Quick suggestion chips — both in topbar and empty state
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    qs('searchInput').value = chip.dataset.chip;
    runAnalysis();
  });
});

qs('analyzeBtn').addEventListener('click', runAnalysis);
qs('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runAnalysis();
});

// ===================== ANALYZE FLOW =====================
async function runAnalysis() {
  const query = qs('searchInput').value.trim();
  if (!query) return;

  const condition = qs('conditionFilter').value;
  const marketplace = qs('marketplaceFilter').value;

  qs('emptyState').style.display = 'none';
  qs('pages').style.display = 'block';
  qs('analyzeBtn').disabled = true;
  qs('analyzeBtn').textContent = 'Analyzing…';
  resetLoadingBlocks();

  // Switch to Overview page automatically
  showPage('overview');

  try {
    const res = await fetch(
      `/api/ebay-search?q=${encodeURIComponent(query)}&condition=${condition}&marketplace=${marketplace}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch eBay data.');

    state.result = data;

    if (!data.stats) {
      showNoResults();
      return;
    }

    renderPricing(data.stats);
    renderCompetition(data.stats, data.listings);
    renderKeyword(data.stats);
    renderProduct(data.listings);
    renderBuyer(data.listings);

    // AI insight is fetched separately so real data shows immediately
    fetchAIInsight(query, data.stats);
    fetchSoldData(query);
  } catch (err) {
    qs('overviewTitle').textContent = 'Dashboard Overview';
    qs('marketSummary').innerHTML = `<div class="banner error">⚠️ ${err.message}</div>`;
  } finally {
    qs('analyzeBtn').disabled = false;
    qs('analyzeBtn').textContent = 'Analyze';
  }
}

function showNoResults() {
  qs('marketSummary').innerHTML = `<div class="banner warn">No active listings found for this search. Try a different keyword.</div>`;
  ['pricingKpis', 'competitionKpis', 'topSellersList', 'powerKeywords', 'productBody', 'buyerBody'].forEach(
    (id) => { qs(id).innerHTML = ''; }
  );
}

function resetLoadingBlocks() {
  const loading = (text = 'Loading AI analysis…') =>
    `<div class="loading-state">${text}</div>`;
  qs('marketSummary').innerHTML = loading();
  qs('healthBlock').innerHTML = loading();
  qs('entryBarrierBlock').innerHTML = loading();
  qs('optimizedTitleBlock').innerHTML = loading();
  qs('insightList').innerHTML = `<li class="loading-state">Loading…</li>`;
  qs('actionList').innerHTML = `<li class="loading-state">Loading…</li>`;
  qs('finalRecCard').innerHTML = loading('Loading final recommendation…');
  qs('scoreGrid').innerHTML = '';
  qs('demandBody').innerHTML = loading('Checking sold data availability…');
}

// ===================== OVERVIEW (AI) =====================
async function fetchAIInsight(query, stats) {
  try {
    const res = await fetch('/api/ai-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, stats }),
    });
    const ai = await res.json();
    if (!res.ok) throw new Error(ai.error || 'Failed to load AI insight.');

    state.ai = ai;
    qs('overviewTitle').textContent = `Dashboard Overview — "${query}"`;
    renderScoreGrid(ai);

    qs('marketSummary').innerHTML = `<p style="margin:0; line-height:1.65;">${ai.marketSummary}</p>`;
    qs('healthBlock').innerHTML = `
      <div style="margin-bottom:10px;">
        <span class="tag pink">${ai.productHealthIndicator}</span>
      </div>
      <p style="margin:0; color:var(--text-secondary); line-height:1.6;">${ai.recommendedAction}</p>`;

    qs('entryBarrierBlock').innerHTML = `
      <div class="kpi-box" style="margin-bottom:12px; display:inline-block; min-width:160px;">
        <div class="kpi-label">Entry Barrier Score</div>
        <div class="kpi-value">${ai.entryBarrierScore}<span style="font-size:14px; font-weight:500; color:var(--text-muted)">/100</span></div>
      </div>
      <p style="margin:0; color:var(--text-secondary); line-height:1.6;">${ai.recommendedAction}</p>`;

    qs('optimizedTitleBlock').innerHTML = `
      <div style="background:var(--surface-alt); border:1px solid var(--border); border-radius:8px; padding:12px 14px;">
        <p style="margin:0; font-weight:600; font-size:14px; line-height:1.5; color:var(--text-primary);">"${ai.optimizedTitle}"</p>
        <p style="margin:8px 0 0; font-size:11.5px; color:var(--text-muted);">Max 80 characters · AI-optimized for eBay search</p>
      </div>`;

    qs('insightList').innerHTML = (ai.insights || []).map((i) => `<li>${i}</li>`).join('');
    qs('actionList').innerHTML = (ai.actionPlans || []).map((i) => `<li>${i}</li>`).join('');

    const recClass =
      ai.finalRecommendation === 'Buy' ? 'buy' :
      ai.finalRecommendation === 'Avoid' ? 'avoid' : 'test';
    qs('finalRecCard').innerHTML = `
      <div class="rec-badge ${recClass}">${ai.finalRecommendation}</div>
      <p style="margin:0; color:var(--text-secondary); line-height:1.65;">${ai.finalRecommendationReason}</p>`;
  } catch (err) {
    qs('marketSummary').innerHTML = `<div class="banner error">⚠️ ${err.message}</div>`;
    qs('finalRecCard').innerHTML = `<div class="banner error">⚠️ ${err.message}</div>`;
    qs('healthBlock').innerHTML = '';
    qs('entryBarrierBlock').innerHTML = '';
    qs('optimizedTitleBlock').innerHTML = '';
    qs('insightList').innerHTML = '';
    qs('actionList').innerHTML = '';
  }
}

function renderScoreGrid(ai) {
  const items = [
    ['Opportunity Score', ai.opportunityScore, 'How promising this market is overall'],
    ['Entry Barrier', ai.entryBarrierScore, 'How hard it is for new sellers to enter'],
    ['Competition Score', ai.competitionScore, 'Market saturation level'],
    ['Demand Score', ai.demandScore, 'Estimated buyer demand'],
    ['Profitability Score', ai.profitabilityScore, 'Estimated margin potential'],
    ['Growth Potential', ai.growthPotentialScore, 'Long-term growth outlook'],
  ];
  qs('scoreGrid').innerHTML = items
    .map(
      ([label, val, hint]) => `
    <div class="card score-card">
      <div class="score-label">${label}</div>
      <div class="score-value">${val}</div>
      <div class="score-bar"><div style="width:${val}%"></div></div>
      <div style="font-size:11px; color:var(--text-muted); margin-top:8px;">${hint}</div>
    </div>`
    )
    .join('');
}

// ===================== PRICING =====================
function renderPricing(stats) {
  qs('pricingKpis').innerHTML = `
    <div class="kpi-box"><div class="kpi-label">Avg Price</div><div class="kpi-value">${fmtMoney(stats.avgPrice)}</div></div>
    <div class="kpi-box"><div class="kpi-label">Median Price</div><div class="kpi-value">${fmtMoney(stats.medianPrice)}</div></div>
    <div class="kpi-box"><div class="kpi-label">Min Price</div><div class="kpi-value">${fmtMoney(stats.minPrice)}</div></div>
    <div class="kpi-box"><div class="kpi-label">Max Price</div><div class="kpi-value">${fmtMoney(stats.maxPrice)}</div></div>`;

  if (state.charts.hist) state.charts.hist.destroy();
  state.charts.hist = new Chart(qs('priceHistogramChart'), {
    type: 'bar',
    data: {
      labels: stats.histogram.map((h) => h.range),
      datasets: [{
        label: 'Listings',
        data: stats.histogram.map((h) => h.count),
        backgroundColor: 'rgba(166, 39, 92, 0.75)',
        borderRadius: 4,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { grid: { display: false } },
      },
    },
  });

  if (state.charts.bin) state.charts.bin.destroy();
  state.charts.bin = new Chart(qs('binAuctionChart'), {
    type: 'doughnut',
    data: {
      labels: ['Buy It Now', 'Auction'],
      datasets: [{
        data: [stats.binCount, stats.auctionCount],
        backgroundColor: ['#1d7a3c', '#f3d9e2'],
        borderWidth: 0,
      }],
    },
    options: {
      plugins: { legend: { position: 'bottom' } },
      cutout: '65%',
    },
  });
}

// ===================== COMPETITION =====================
function buildListingRow(item) {
  const img = item.image || 'https://via.placeholder.com/46';
  return `
    <div class="listing-row" data-item-id="${item.itemId}">
      <img src="${img}" alt="" loading="lazy" />
      <div style="min-width:0; flex:1;">
        <div class="l-title">${item.title}</div>
        <div class="l-meta">@${item.seller?.username || 'unknown'} · ${item.condition || 'N/A'} · ${item.itemLocationCountry || ''}</div>
      </div>
      <button class="btn-secondary save-listing-btn" data-save-id="${item.itemId}" style="padding:5px 10px; font-size:11.5px; flex-shrink:0;">☆ Save</button>
      <div class="l-price">${fmtMoney(item.price, item.currency)}<span class="l-link-icon">↗</span></div>
    </div>`;
}

function renderCompetition(stats, listings) {
  qs('competitionKpis').innerHTML = `
    <div class="kpi-box"><div class="kpi-label">Active Listings</div><div class="kpi-value">${stats.totalActiveListings}</div></div>
    <div class="kpi-box"><div class="kpi-label">Active Sellers</div><div class="kpi-value">${stats.uniqueSellers}</div></div>
    <div class="kpi-box"><div class="kpi-label">Top-3 Seller Share</div><div class="kpi-value">${stats.top3SellerShare}%</div></div>`;

  qs('topSellersList').innerHTML = stats.topSellers
    .map(
      (s) => `
    <div class="listing-row" style="cursor:default;">
      <div style="min-width:0; flex:1;">
        <div class="l-title">@${s.username}</div>
        <div class="l-meta">Feedback ${s.feedbackPercentage ?? '-'}% · Score ${s.feedbackScore?.toLocaleString() ?? '-'}</div>
      </div>
      <div class="l-price" style="color:var(--text-secondary); font-size:13px;">${s.count} listing${s.count !== 1 ? 's' : ''}</div>
    </div>`
    )
    .join('');

  // Full listings comparison panel
  const wrapId = 'competitionListingsWrap';
  if (!qs(wrapId)) {
    const wrap = document.createElement('div');
    wrap.id = wrapId;
    wrap.innerHTML = `
      <div class="card" style="margin-top:14px;">
        <div class="card-title">Compare Active Listings — click any row to open on eBay</div>
        <div id="competitionListings"></div>
      </div>`;
    document.querySelector('[data-content="competition"]').appendChild(wrap);
  }
  qs('competitionListings').innerHTML = listings.map(buildListingRow).join('');

  document.querySelectorAll('#competitionListings .listing-row').forEach((row) => {
    const item = listings.find((l) => l.itemId === row.dataset.itemId);
    row.addEventListener('click', () => {
      if (item?.itemWebUrl) window.open(item.itemWebUrl, '_blank', 'noopener');
    });
  });

  document.querySelectorAll('.save-listing-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = listings.find((l) => l.itemId === btn.dataset.saveId);
      if (!item) return;
      const saved = getSaved();
      if (!saved.find((s) => s.itemId === item.itemId)) {
        saved.push(item);
        localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
        btn.textContent = '★ Saved';
        btn.style.color = 'var(--primary-dark)';
        btn.style.borderColor = 'var(--primary)';
      }
    });
  });
}

// ===================== KEYWORD =====================
function renderKeyword(stats) {
  qs('powerKeywords').innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap:7px;">
      ${stats.topKeywords
        .map(
          (k) => `<span class="tag purple" style="font-size:12px; padding:4px 11px;">${k.word}
            <span style="margin-left:6px; opacity:0.6; font-weight:400;">×${k.count}</span>
          </span>`
        )
        .join('')}
    </div>`;
}

// ===================== PRODUCT (condition breakdown) =====================
function renderProduct(listings) {
  const condCount = new Map();
  listings.forEach((l) => {
    const c = l.condition || 'Unknown';
    condCount.set(c, (condCount.get(c) || 0) + 1);
  });
  const rows = Array.from(condCount.entries()).sort((a, b) => b[1] - a[1]);

  qs('productBody').innerHTML = `
    <div class="card module-card product">
      <div class="card-title">Listings by Condition</div>
      ${rows
        .map(
          ([cond, count]) => `
        <div class="listing-row" style="cursor:default;">
          <div class="l-title">${cond}</div>
          <div class="l-price" style="color:var(--text-secondary);">${count} listing${count !== 1 ? 's' : ''}</div>
        </div>`
        )
        .join('')}
    </div>`;
}

// ===================== BUYER (geographic proxy from seller location) =====================
function renderBuyer(listings) {
  const countryCount = new Map();
  listings.forEach((l) => {
    const c = l.itemLocationCountry || 'Unknown';
    countryCount.set(c, (countryCount.get(c) || 0) + 1);
  });
  const entries = Array.from(countryCount.entries()).sort((a, b) => b[1] - a[1]);

  qs('buyerBody').innerHTML = `
    <div class="banner info">Note: eBay does not expose buyer location via its public API. The chart below shows seller location from active listings — a rough proxy for which markets are most active for this product.</div>
    <div class="card module-card buyer">
      <div class="card-title">Seller Location Distribution (Active Listings)</div>
      <canvas id="geoChart" height="200"></canvas>
    </div>`;

  if (state.charts.geo) state.charts.geo.destroy();
  state.charts.geo = new Chart(qs('geoChart'), {
    type: 'bar',
    data: {
      labels: entries.map((e) => e[0]),
      datasets: [{
        label: 'Listings',
        data: entries.map((e) => e[1]),
        backgroundColor: 'rgba(210, 105, 30, 0.75)',
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
    },
  });
}

// ===================== DEMAND (optional scraper) =====================
async function fetchSoldData(query) {
  try {
    const res = await fetch(`/api/sold-scraper?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.available) {
      qs('demandBody').innerHTML = `<div class="banner warn">${data.message || 'Scraper API not configured.'}</div>`;
      return;
    }
    if (!data.soldCount) {
      qs('demandBody').innerHTML = `<div class="banner warn">${data.message}</div>`;
      return;
    }
    qs('demandBody').innerHTML = `
      <div class="kpi-row">
        <div class="kpi-box"><div class="kpi-label">Sold (snapshot)</div><div class="kpi-value">${data.soldCount}</div></div>
        <div class="kpi-box"><div class="kpi-label">Avg Sold Price</div><div class="kpi-value">${fmtMoney(data.avgSoldPrice)}</div></div>
        <div class="kpi-box"><div class="kpi-label">Min / Max Sold</div><div class="kpi-value">${fmtMoney(data.minSoldPrice)} – ${fmtMoney(data.maxSoldPrice)}</div></div>
      </div>
      <div class="banner info">${data.note}</div>`;
  } catch (err) {
    qs('demandBody').innerHTML = `<div class="banner error">⚠️ ${err.message}</div>`;
  }
}

// ===================== SAVED PRODUCTS =====================
const SAVED_KEY = 'sellore_saved_products';

function getSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; }
  catch { return []; }
}

function renderSavedList() {
  const saved = getSaved();
  if (!saved.length) {
    qs('savedList').innerHTML = `
      <div class="empty-state" style="padding:40px 20px;">
        <div class="emoji">📌</div>No saved products yet.<br>
        <span style="font-size:12px; color:var(--text-muted);">Click ☆ Save on any listing to bookmark it here.</span>
      </div>`;
    return;
  }
  qs('savedList').innerHTML = saved
    .map(
      (s) => `
    <div class="saved-row">
      <img src="${s.image || 'https://via.placeholder.com/42'}" style="width:42px;height:42px;border-radius:8px;object-fit:cover;border:1px solid var(--border);" />
      <div style="flex:1; min-width:0;">
        <div class="l-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.title}</div>
        <div class="l-meta">${fmtMoney(s.price, s.currency)} · @${s.seller?.username || ''}</div>
      </div>
      <a href="${s.itemWebUrl}" target="_blank" rel="noopener" class="tag pink" style="flex-shrink:0;">View on eBay ↗</a>
      <button class="remove-btn" data-id="${s.itemId}" title="Remove">✕</button>
    </div>`
    )
    .join('');
  document.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = getSaved().filter((s) => s.itemId !== btn.dataset.id);
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      renderSavedList();
    });
  });
}

// ===================== EXPORT =====================
qs('exportCsvBtn').addEventListener('click', () => {
  if (!state.result?.listings?.length) {
    alert('No data to export. Run an analysis first.');
    return;
  }
  const rows = [
    ['Title', 'Price', 'Currency', 'Condition', 'Seller', 'ItemLocation', 'ItemWebUrl'],
  ];
  state.result.listings.forEach((l) => {
    rows.push([l.title, l.price, l.currency, l.condition, l.seller?.username, l.itemLocationCountry, l.itemWebUrl]);
  });
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sellore-${state.result.query.replace(/\s+/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

qs('exportPdfBtn').addEventListener('click', () => window.print());

// ===================== API SETTINGS: test connections =====================
function setDot(id, ok) {
  qs(id).className = `status-dot ${ok ? 'ok' : 'bad'}`;
}

qs('checkEbayBtn').addEventListener('click', async () => {
  qs('checkEbayBtn').textContent = 'Testing…';
  try {
    const res = await fetch('/api/ebay-search?q=test&condition=ALL&marketplace=US');
    setDot('dotEbay', res.ok);
  } catch { setDot('dotEbay', false); }
  qs('checkEbayBtn').textContent = 'Test Connection';
});

qs('checkDeepseekBtn').addEventListener('click', async () => {
  qs('checkDeepseekBtn').textContent = 'Testing…';
  try {
    const res = await fetch('/api/ai-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test',
        stats: {
          totalActiveListings: 1, uniqueSellers: 1,
          avgPrice: 1, medianPrice: 1, minPrice: 1, maxPrice: 1,
          histogram: [], binCount: 1, auctionCount: 0,
          topSellers: [], top3SellerShare: 100, topKeywords: [],
        },
      }),
    });
    setDot('dotDeepseek', res.ok);
  } catch { setDot('dotDeepseek', false); }
  qs('checkDeepseekBtn').textContent = 'Test Connection';
});

qs('checkScraperBtn').addEventListener('click', async () => {
  qs('checkScraperBtn').textContent = 'Testing…';
  try {
    const res = await fetch('/api/sold-scraper?q=test');
    const data = await res.json();
    setDot('dotScraper', !!data.available);
  } catch { setDot('dotScraper', false); }
  qs('checkScraperBtn').textContent = 'Test Connection';
});
