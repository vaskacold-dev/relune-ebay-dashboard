// netlify/functions/sold-scraper.js
//
// GET /api/sold-scraper?q=<nama produk>
//
// FUNGSI INI OPSIONAL. eBay TIDAK punya API resmi untuk data sold/terjual
// (Finding API yang dulu menyediakan ini sudah di-decommission per Feb 2025).
// Fungsi ini mengambil data sold dengan cara: menyuruh scraper API pihak
// ketiga membuka halaman pencarian "sold" di ebay.com, lalu kita parsing
// HTML-nya. Karena ini scraping, SELECTOR CSS BISA RUSAK kapan saja kalau
// eBay mengubah tampilan situsnya -- itu risiko yang melekat pada scraping,
// bukan pada kode ini.
//
// ======================================================================
// GANTI BAGIAN INI sesuai provider scraper API yang Anda pakai.
// Pola di bawah ini contoh untuk ScraperAPI (https://www.scraperapi.com),
// formatnya: GET https://api.scraperapi.com?api_key=KEY&url=TARGET_URL
//
// Provider lain pakai parameter berbeda, contoh:
//   - ScrapingBee : https://app.scrapingbee.com/api/v1/?api_key=KEY&url=TARGET_URL
//   - ZenRows     : https://api.zenrows.com/v1/?apikey=KEY&url=TARGET_URL
//   - Scrapingdog : https://api.scrapingdog.com/scrape?api_key=KEY&url=TARGET_URL
// Cek dokumentasi provider Anda, lalu sesuaikan fungsi di bawah ini.
// ======================================================================
function buildScraperRequestUrl(targetUrl) {
  const apiKey = process.env.SCRAPER_API_KEY;
  // --- GANTI BARIS INI SESUAI PROVIDER ANDA ---
  return `https://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}`;
}

exports.handler = async function (event) {
  try {
    const apiKey = process.env.SCRAPER_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          available: false,
          message:
            'SCRAPER_API_KEY belum diisi di Netlify Environment Variables. Fitur Demand & Timing (data sold) tidak aktif.',
        }),
      };
    }

    const query = (event.queryStringParameters?.q || '').trim();
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Parameter q wajib diisi.' }) };
    }

    const targetUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
    const scraperUrl = buildScraperRequestUrl(targetUrl);

    const res = await fetch(scraperUrl);
    if (!res.ok) {
      throw new Error(`Scraper API merespons error (status ${res.status}). Cek kuota/API key scraper Anda.`);
    }
    const html = await res.text();

    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    const prices = [];
    // --- SELECTOR INI BISA BERUBAH KAPAN SAJA KARENA EBAY SERING UPDATE HTML-NYA ---
    $('.s-item__price').each((_, el) => {
      const text = $(el).text().replace(/[^0-9.]/g, '');
      const value = parseFloat(text);
      if (!Number.isNaN(value)) prices.push(value);
    });

    if (!prices.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          available: true,
          soldCount: 0,
          message:
            'Scraper berhasil dipanggil tapi 0 harga terbaca. Kemungkinan struktur HTML eBay berubah -- cek/update selector CSS di sold-scraper.js, atau cek apakah scraper API mengembalikan HTML yang benar.',
        }),
      };
    }

    const avgSold = prices.reduce((a, b) => a + b, 0) / prices.length;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        available: true,
        soldCount: prices.length,
        avgSoldPrice: Number(avgSold.toFixed(2)),
        minSoldPrice: Math.min(...prices),
        maxSoldPrice: Math.max(...prices),
        note:
          'Ini snapshot sold listings saat ini (bukan tren historis 12 bulan). Untuk grafik musiman jangka panjang, data ini perlu disimpan ke database setiap hari/minggu -- lihat README bagian "Pengembangan Lanjutan".',
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
