// public/js/app.js
//
// Semua data di sini berasal dari hasil call ke /api/ebay-search,
// /api/ai-insight, dan /api/sold-scraper (lihat netlify/functions/).
// Tidak ada data dummy/acak yang sengaja ditampilkan sebagai hasil real.

const state = {
  result: null, // hasil dari /api/ebay-search
  ai: null,     // hasil dari /api/ai-insight
  charts: {},   // instance Chart.js, supaya bisa di-destroy sebelum re-render
};

const qs = (id) => document.getElementById(id);
const fmtMoney = (v, currency = 'USD') => (v == null ? '-' : `${currency === 'USD' ? '$' : currency + ' '}${v.toFixed(2)}`);

// ===================== NAVIGASI SIDEBAR =====================
function showPage(pageKey) {
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.page === pageKey));
  document.querySelectorAll('[data-content]').forEach((el) => {
    el.style.display = el.dataset.content === pageKey ? 'block' : 'none';
  });
  if (window.innerWidth <= 900) qs('sidebar').classList.remove('open');
  if (pageKey === 'saved') renderSavedList();
}

document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', () => showPage(el.dataset.page));
});

qs('menuToggle').addEventListener('click', () => qs('sidebar').classList.toggle('open'));

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    qs('searchInput').value = chip.dataset.chip;
    runAnalysis();
  });
});

qs('analyzeBtn').addEventListener('click', runAnalysis);
qs('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnalysis(); });

// ===================== ANALYZE FLOW =====================
async function runAnalysis() {
  const query = qs('searchInput').value.trim();
  if (!query) return;

  const condition = qs('conditionFilter').value;
  const marketplace = qs('marketplaceFilter').value;

  qs('emptyState').style.display = 'none';
  qs('pages').style.display = 'block';
  qs('analyzeBtn').disabled = true;
  qs('analyzeBtn').textContent = 'Menganalisis...';
  resetLoadingBlocks();

  try {
    const res = await fetch(`/api/ebay-search?q=${encodeURIComponent(query)}&condition=${condition}&marketplace=${marketplace}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal mengambil data eBay.');

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

    // Strategy/Overview butuh AI -> dipanggil terpisah supaya bagian "real data"
    // tetap muncul cepat walau AI sedang loading.
    fetchAIInsight(query, data.stats);
    fetchSoldData(query);
  } catch (err) {
    qs('overviewTitle').textContent = 'Dashboard Overview';
    qs('marketSummary').innerHTML = `<div class="banner error">${err.message}</div>`;
  } finally {
    qs('analyzeBtn').disabled = false;
    qs('analyzeBtn').textContent = 'Analyze';
  }
}

function showNoResults() {
  qs('marketSummary').innerHTML = `<div class="banner warn">Tidak ada listing aktif ditemukan untuk pencarian ini. Coba kata kunci lain.</div>`;
  ['pricingKpis', 'competitionKpis', 'topSellersList', 'powerKeywords', 'productBody', 'buyerBody'].forEach((id) => {
    qs(id).innerHTML = '';
  });
}

function resetLoadingBlocks() {
  qs('marketSummary').innerHTML = '<div class="loading-state">Memuat analisis AI...</div>';
  qs('healthBlock').innerHTML = '<div class="loading-state">Memuat analisis AI...</div>';
  qs('entryBarrierBlock').innerHTML = '<div class="loading-state">Memuat analisis AI...</div>';
  qs('optimizedTitleBlock').innerHTML = '<div class="loading-state">Memuat analisis AI...</div>';
  qs('insightList').innerHTML = '<li class="loading-state">Memuat...</li>';
  qs('actionList').innerHTML = '<li class="loading-state">Memuat...</li>';
  qs('finalRecCard').innerHTML = '<div class="loading-state">Memuat rekomendasi akhir...</div>';
  qs('scoreGrid').innerHTML = '';
  qs('demandBody').innerHTML = '<div class="loading-state">Mengecek ketersediaan data sold...</div>';
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
    if (!res.ok) throw new Error(ai.error || 'Gagal memuat AI insight.');

    state.ai = ai;
    qs('overviewTitle').textContent = `Dashboard Overview — "${query}"`;
    renderScoreGrid(ai);
    qs('marketSummary').innerHTML = `<p style="margin:0;">${ai.marketSummary}</p>`;
    qs('healthBlock').innerHTML = `
      <div style="margin-bottom:10px;"><span class="tag pink">${ai.productHealthIndicator}</span></div>
      <p style="margin:0; color:var(--text-secondary);">${ai.recommendedAction}</p>`;
    qs('entryBarrierBlock').innerHTML = `
      <div class="kpi-box" style="margin-bottom:10px;">
        <div class="kpi-label">Entry Barrier Score</div>
        <div class="kpi-value">${ai.entryBarrierScore}/100</div>
      </div>
      <p style="margin:0; color:var(--text-secondary);">${ai.recommendedAction}</p>`;
    qs('optimizedTitleBlock').innerHTML = `<p style="margin:0; font-weight:600;">"${ai.optimizedTitle}"</p>`;

    qs('insightList').innerHTML = (ai.insights || []).map((i) => `<li>${i}</li>`).join('');
    qs('actionList').innerHTML = (ai.actionPlans || []).map((i) => `<li>${i}</li>`).join('');

    const recClass = ai.finalRecommendation === 'Buy' ? 'buy' : ai.finalRecommendation === 'Avoid' ? 'avoid' : 'test';
    qs('finalRecCard').innerHTML = `
      <div class="rec-badge ${recClass}">${ai.finalRecommendation}</div>
      <p style="margin:0; color:var(--text-secondary);">${ai.finalRecommendationReason}</p>`;
  } catch (err) {
    qs('marketSummary').innerHTML = `<div class="banner error">${err.message}</div>`;
    qs('finalRecCard').innerHTML = `<div class="banner error">${err.message}</div>`;
  }
}

function renderScoreGrid(ai) {
  const items = [
    ['Opportunity Score', ai.opportunityScore],
    ['Entry Barrier Score', ai.entryBarrierScore],
    ['Competition Score', ai.competitionScore],
    ['Demand Score', ai.demandScore],
    ['Profitability Score', ai.profitabilityScore],
    ['Growth Potential Score', ai.growthPotentialScore],
  ];
  qs('scoreGrid').innerHTML = items.map(([label, val]) => `
    <div class="card score-card">
      <div class="score-label">${label}</div>
      <div class="score-value">${val}</div>
      <div class="score-bar"><div style="width:${val}%"></div></div>
    </div>`).join('');
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
      datasets: [{ label: 'Jumlah listing', data: stats.histogram.map((h) => h.count), backgroundColor: '#a6275c' }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });

  if (state.charts.bin) state.charts.bin.destroy();
  state.charts.bin = new Chart(qs('binAuctionChart'), {
    type: 'doughnut',
    data: {
      labels: ['Buy It Now', 'Auction'],
      datasets: [{ data: [stats.binCount, stats.auctionCount], backgroundColor: ['#1d7a3c', '#f3d9e2'] }],
    },
    options: { plugins: { legend: { position: 'bottom' } } },
  });
}

// ===================== COMPETITION =====================
function buildListingRow(item) {
  const img = item.image || 'https://via.placeholder.com/44';
  return `
    <div class="listing-row" data-item-id="${item.itemId}">
      <img src="${img}" alt="" loading="lazy" />
      <div style="min-width:0;">
        <div class="l-title">${item.title}</div>
        <div class="l-meta">@${item.seller?.username || 'unknown'} · ${item.condition || ''} · ${item.itemLocationCountry || ''}</div>
      </div>
      <button class="btn-secondary save-listing-btn" data-save-id="${item.itemId}" style="padding:4px 9px; font-size:11px;">☆ Simpan</button>
      <div class="l-price">${fmtMoney(item.price, item.currency)}<span class="l-link-icon">↗</span></div>
    </div>`;
}

function renderCompetition(stats, listings) {
  qs('competitionKpis').innerHTML = `
    <div class="kpi-box"><div class="kpi-label">Active Listings</div><div class="kpi-value">${stats.totalActiveListings}</div></div>
    <div class="kpi-box"><div class="kpi-label">Active Sellers</div><div class="kpi-value">${stats.uniqueSellers}</div></div>
    <div class="kpi-box"><div class="kpi-label">Top-3 Seller Share</div><div class="kpi-value">${stats.top3SellerShare}%</div></div>`;

  qs('topSellersList').innerHTML = stats.topSellers.map((s) => `
    <div class="listing-row" style="cursor:default;">
      <div style="min-width:0;">
        <div class="l-title">${s.username}</div>
        <div class="l-meta">Feedback ${s.feedbackPercentage ?? '-'}% · Score ${s.feedbackScore ?? '-'}</div>
      </div>
      <div class="l-price">${s.count} listing</div>
    </div>`).join('');

  // Daftar listing lengkap untuk dibandingkan -> klik = buka produk asli di eBay (tab baru)
  const listingsHtml = `
    <div class="card" style="margin-top:14px;">
      <div class="card-title">Bandingkan Listing Aktif (klik untuk membuka produk asli di eBay)</div>
      <div id="competitionListings"></div>
    </div>`;
  if (!qs('competitionListingsWrap')) {
    const wrap = document.createElement('div');
    wrap.id = 'competitionListingsWrap';
    wrap.innerHTML = listingsHtml;
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
        btn.textContent = '★ Tersimpan';
      }
    });
  });
}

// ===================== KEYWORD =====================
function renderKeyword(stats) {
  qs('powerKeywords').innerHTML = `<div style="display:flex; flex-wrap:wrap; gap:8px;">${
    stats.topKeywords.map((k) => `<span class="tag purple">${k.word} · ${k.count}</span>`).join('')
  }</div>`;
}

// ===================== PRODUCT (condition breakdown) =====================
function renderProduct(listings) {
  const condCount = new Map();
  listings.forEach((l) => {
    const c = l.condition || 'Tidak diketahui';
    condCount.set(c, (condCount.get(c) || 0) + 1);
  });
  const rows = Array.from(condCount.entries()).sort((a, b) => b[1] - a[1]);

  qs('productBody').innerHTML = `
    <div class="card module-card product">
      <div class="card-title">Performa per Kondisi Barang (dari listing aktif)</div>
      ${rows.map(([cond, count]) => `
        <div class="listing-row" style="cursor:default;">
          <div class="l-title">${cond}</div>
          <div class="l-price">${count} listing</div>
        </div>`).join('')}
    </div>`;
}

// ===================== BUYER (geographic, dari lokasi seller listing aktif) =====================
function renderBuyer(listings) {
  const countryCount = new Map();
  listings.forEach((l) => {
    const c = l.itemLocationCountry || 'Tidak diketahui';
    countryCount.set(c, (countryCount.get(c) || 0) + 1);
  });
  const entries = Array.from(countryCount.entries()).sort((a, b) => b[1] - a[1]);

  qs('buyerBody').innerHTML = `
    <div class="banner info">Catatan: eBay tidak mengekspos data lokasi BUYER ke seller lain lewat API publik. Yang ditampilkan di bawah adalah lokasi SELLER pada listing aktif, sebagai proxy kasar untuk melihat pasar mana yang ramai.</div>
    <div class="card module-card buyer">
      <div class="card-title">Distribusi Lokasi Seller (Listing Aktif)</div>
      <canvas id="geoChart" height="180"></canvas>
    </div>`;

  if (state.charts.geo) state.charts.geo.destroy();
  state.charts.geo = new Chart(qs('geoChart'), {
    type: 'bar',
    data: {
      labels: entries.map((e) => e[0]),
      datasets: [{ label: 'Jumlah listing', data: entries.map((e) => e[1]), backgroundColor: '#d2691e' }],
    },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}

// ===================== DEMAND (scraper opsional) =====================
async function fetchSoldData(query) {
  try {
    const res = await fetch(`/api/sold-scraper?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.available) {
      qs('demandBody').innerHTML = `<div class="banner warn">${data.message || 'Scraper API belum dikonfigurasi.'}</div>`;
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
        <div class="kpi-box"><div class="kpi-label">Min / Max Sold</div><div class="kpi-value">${fmtMoney(data.minSoldPrice)} - ${fmtMoney(data.maxSoldPrice)}</div></div>
      </div>
      <div class="banner info">${data.note}</div>`;
  } catch (err) {
    qs('demandBody').innerHTML = `<div class="banner error">${err.message}</div>`;
  }
}

// ===================== SAVED PRODUCTS (localStorage) =====================
const SAVED_KEY = 'ebayiq_saved_products';
function getSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch { return []; }
}
function renderSavedList() {
  const saved = getSaved();
  if (!saved.length) {
    qs('savedList').innerHTML = `<div class="empty-state"><div class="emoji">📌</div>Belum ada produk disimpan.</div>`;
    return;
  }
  qs('savedList').innerHTML = saved.map((s) => `
    <div class="saved-row">
      <img src="${s.image || 'https://via.placeholder.com/40'}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;" />
      <div><div class="l-title">${s.title}</div><div class="l-meta">${fmtMoney(s.price, s.currency)}</div></div>
      <a href="${s.itemWebUrl}" target="_blank" rel="noopener" class="tag pink">Lihat di eBay</a>
      <button class="remove-btn" data-id="${s.itemId}">✕</button>
    </div>`).join('');
  document.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = getSaved().filter((s) => s.itemId !== btn.dataset.id);
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      renderSavedList();
    });
  });
}

// ===================== EXPORT (Reports) =====================
qs('exportCsvBtn').addEventListener('click', () => {
  if (!state.result?.listings?.length) { alert('Belum ada data untuk diexport. Jalankan Analyze dulu.'); return; }
  const rows = [['Title', 'Price', 'Currency', 'Condition', 'Seller', 'ItemLocation', 'ItemWebUrl']];
  state.result.listings.forEach((l) => {
    rows.push([l.title, l.price, l.currency, l.condition, l.seller?.username, l.itemLocationCountry, l.itemWebUrl]);
  });
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ebayiq-${state.result.query.replace(/\s+/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

qs('exportPdfBtn').addEventListener('click', () => window.print());

// ===================== API SETTINGS: cek koneksi =====================
function setDot(id, ok) {
  qs(id).className = `status-dot ${ok ? 'ok' : 'bad'}`;
}

qs('checkEbayBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/ebay-search?q=test&condition=ALL&marketplace=US');
    setDot('dotEbay', res.ok);
  } catch { setDot('dotEbay', false); }
});

qs('checkDeepseekBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/ai-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', stats: { totalActiveListings: 1, uniqueSellers: 1, avgPrice: 1, medianPrice: 1, minPrice: 1, maxPrice: 1, histogram: [], binCount: 1, auctionCount: 0, topSellers: [], top3SellerShare: 100, topKeywords: [] } }),
    });
    setDot('dotDeepseek', res.ok);
  } catch { setDot('dotDeepseek', false); }
});

qs('checkScraperBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/sold-scraper?q=test');
    const data = await res.json();
    setDot('dotScraper', !!data.available);
  } catch { setDot('dotScraper', false); }
});
