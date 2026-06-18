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
  // country_code=us memaksa ScraperAPI memakai IP dari Amerika Serikat, supaya
  // eBay selalu mengembalikan halaman versi US (bahasa Inggris, mata uang USD).
  // Tanpa ini, ScraperAPI bisa memakai IP dari negara mana pun secara acak,
  // dan eBay akan menampilkan versi lokal negara itu (contoh: bahasa Portugis
  // + mata uang R$ kalau IP terdeteksi dari Brasil) -- yang membuat parsing
  // harga di bawah jadi gagal karena formatnya berbeda dari yang diharapkan.
  return `https://api.scraperapi.com?api_key=${apiKey}&country_code=us&url=${encodeURIComponent(targetUrl)}`;
}

exports.handler = async function (event) {
  try {
    const apiKey = process.env.SCRAPER_API_KEY;
    console.log('[sold-scraper] apiKey terbaca?', apiKey ? `YA (panjang ${apiKey.length} karakter)` : 'TIDAK (undefined/kosong)');

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
    console.log('[sold-scraper] query:', query);
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Parameter q wajib diisi.' }) };
    }

    const targetUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
    const scraperUrl = buildScraperRequestUrl(targetUrl);
    console.log('[sold-scraper] memanggil scraper untuk targetUrl:', targetUrl);

    const res = await fetch(scraperUrl);
    console.log('[sold-scraper] status response dari ScraperAPI:', res.status);

    if (!res.ok) {
      const errBody = await res.text();
      console.log('[sold-scraper] body error dari ScraperAPI:', errBody.slice(0, 500));
      throw new Error(`Scraper API merespons error (status ${res.status}). Cek kuota/API key scraper Anda.`);
    }
    const html = await res.text();
    console.log('[sold-scraper] panjang HTML diterima:', html.length, 'karakter');
    console.log('[sold-scraper] cuplikan awal HTML:', html.slice(0, 300));

    // Catatan: sebelumnya parsing pakai library "cheerio", tapi cheerio versi
    // terbaru butuh global "File" API yang tidak selalu tersedia di runtime
    // serverless Netlify -- menyebabkan error "File is not defined". Untuk
    // menghindari dependency itu sepenuhnya, kita parsing harga langsung dari
    // HTML mentah pakai regex. Ini lebih ringan dan tidak rentan masalah versi.
    const prices = [];
    // Pola umum di markup hasil pencarian eBay: class "s-item__price" diikuti
    // teks harga dalam format "$123.45" (kadang ada koma untuk ribuan).
    const priceBlockRegex = /s-item__price[^>]*>([^<]*)</g;
    let match;
    while ((match = priceBlockRegex.exec(html)) !== null) {
      const rawText = match[1];
      const cleaned = rawText.replace(/[^0-9.]/g, '');
      const value = parseFloat(cleaned);
      if (!Number.isNaN(value) && value > 0) prices.push(value);
    }
    console.log('[sold-scraper] jumlah harga ditemukan dengan regex s-item__price:', prices.length);

    // FALLBACK: kalau selector class di atas tidak menemukan apa pun (tanda
    // eBay sudah mengubah nama class CSS-nya lagi), coba cari langsung pola
    // umum harga listing dalam format "$123.45" atau "$1,234.56" di body HTML.
    // Ini kurang presisi (bisa menangkap harga shipping/filter juga), tapi
    // jadi fallback yang masih lebih baik daripada gagal total.
    if (!prices.length) {
      const genericPriceRegex = />\s*\$\s?([0-9][0-9,]*\.[0-9]{2})\s*</g;
      let gMatch;
      while ((gMatch = genericPriceRegex.exec(html)) !== null) {
        const cleaned = gMatch[1].replace(/,/g, '');
        const value = parseFloat(cleaned);
        if (!Number.isNaN(value) && value > 0) prices.push(value);
      }
      console.log('[sold-scraper] fallback: jumlah harga ditemukan dengan pola generik $xx.xx:', prices.length);
    }

    // DIAGNOSTIK SEMENTARA: kalau 0 harga ketemu, tunjukkan cuplikan HTML di
    // sekitar BEBERAPA kemunculan simbol dollar ($) -- kemunculan paling awal
    // biasanya masih bagian filter sidebar ("Under $15.00" dst), bukan listing
    // produk sungguhan. Kita ambil kemunculan ke-8 s.d. ke-12 supaya kemungkinan
    // besar sudah melewati filter dan masuk ke area listing produk asli.
    if (!prices.length) {
      const lowerHtml = html.toLowerCase();

      const dollarIndices = [];
      let searchPos = 0;
      while (dollarIndices.length < 15) {
        const idx = html.indexOf('$', searchPos);
        if (idx === -1) break;
        dollarIndices.push(idx);
        searchPos = idx + 1;
      }
      console.log('[sold-scraper] DIAGNOSTIK total kemunculan $ ditemukan (maks 15 dicatat):', dollarIndices.length);

      // Tampilkan cuplikan di sekitar kemunculan ke-8 s.d. ke-12 (index 7-11)
      for (let i = 7; i <= 11 && i < dollarIndices.length; i++) {
        const idx = dollarIndices[i];
        console.log(`[sold-scraper] DIAGNOSTIK cuplikan sekitar $ ke-${i + 1}:`, html.slice(Math.max(0, idx - 250), idx + 50));
      }

      // Cek juga indikasi captcha/blocking dari eBay
      if (lowerHtml.includes('captcha') || lowerHtml.includes('pardon our interruption') || lowerHtml.includes('are you a human')) {
        console.log('[sold-scraper] DIAGNOSTIK: terindikasi halaman CAPTCHA/blokir dari eBay, bukan halaman hasil pencarian asli.');
      }
    }

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
    console.log('[sold-scraper] SUKSES, avgSoldPrice:', avgSold.toFixed(2));

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
    console.log('[sold-scraper] ERROR tertangkap:', err.message);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
