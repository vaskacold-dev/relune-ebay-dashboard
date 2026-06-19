// netlify/functions/sold-scraper.js
//
// GET /api/sold-scraper?q=<product name>
//
// THIS FUNCTION IS OPTIONAL. eBay does NOT have an official API for sold/completed
// data (the Finding API that previously provided this was decommissioned in Feb 2025).
// This function retrieves sold data by: instructing a third-party scraper API to open
// the "sold" search page on ebay.com, then parsing the HTML. Because this is scraping,
// CSS SELECTORS CAN BREAK at any time if eBay changes their site layout — that's an
// inherent risk of scraping, not a bug in this code.
//
// ======================================================================
// REPLACE THIS SECTION to match whichever scraper API provider you use.
// The pattern below is an example for ScraperAPI (https://www.scraperapi.com):
// GET https://api.scraperapi.com?api_key=KEY&url=TARGET_URL
//
// Other providers use different parameters, for example:
//   - ScrapingBee : https://app.scrapingbee.com/api/v1/?api_key=KEY&url=TARGET_URL
//   - ZenRows     : https://api.zenrows.com/v1/?apikey=KEY&url=TARGET_URL
//   - Scrapingdog : https://api.scrapingdog.com/scrape?api_key=KEY&url=TARGET_URL
// Check your provider's documentation, then update the function below accordingly.
// ======================================================================
function buildScraperRequestUrl(targetUrl) {
  const apiKey = process.env.SCRAPER_API_KEY;
  // --- REPLACE THIS LINE TO MATCH YOUR PROVIDER ---
  // country_code=us forces ScraperAPI to use a US IP address, so eBay always
  // returns the US version of the page (English language, USD currency).
  // Without this, ScraperAPI may use an IP from any country, and eBay will
  // display that country's local version (e.g. Portuguese + BRL if IP is from Brazil),
  // which would break the price parsing below since the format differs.
  return `https://api.scraperapi.com?api_key=${apiKey}&country_code=us&url=${encodeURIComponent(targetUrl)}`;
}

exports.handler = async function (event) {
  try {
    const apiKey = process.env.SCRAPER_API_KEY;
    console.log('[sold-scraper] apiKey found?', apiKey ? `YES (length: ${apiKey.length})` : 'NO (undefined/empty)');

    if (!apiKey) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          available: false,
          message:
            'SCRAPER_API_KEY is not set in Netlify Environment Variables. Demand & Timing (sold data) feature is disabled.',
        }),
      };
    }

    const query = (event.queryStringParameters?.q || '').trim();
    console.log('[sold-scraper] query:', query);
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Parameter q is required.' }) };
    }

    const targetUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
    const scraperUrl = buildScraperRequestUrl(targetUrl);
    console.log('[sold-scraper] calling scraper for targetUrl:', targetUrl);

    const res = await fetch(scraperUrl);
    console.log('[sold-scraper] ScraperAPI response status:', res.status);

    if (!res.ok) {
      const errBody = await res.text();
      console.log('[sold-scraper] ScraperAPI error body:', errBody.slice(0, 500));
      throw new Error(`Scraper API returned error (status ${res.status}). Check your scraper quota/API key.`);
    }
    const html = await res.text();
    console.log('[sold-scraper] HTML length received:', html.length, 'characters');
    console.log('[sold-scraper] HTML preview:', html.slice(0, 300));

    // Note: previously parsed with "cheerio", but newer versions of cheerio require
    // a global "File" API not always available in Netlify's serverless runtime,
    // causing "File is not defined" errors. To avoid that dependency entirely,
    // we parse prices directly from raw HTML using regex. Lighter and not vulnerable
    // to version issues.
    const prices = [];
    // Common pattern in eBay search result markup: class "s-item__price" followed
    // by price text in format "$123.45" (sometimes with commas for thousands).
    const priceBlockRegex = /s-item__price[^>]*>([^<]*)</g;
    let match;
    while ((match = priceBlockRegex.exec(html)) !== null) {
      const rawText = match[1];
      const cleaned = rawText.replace(/[^0-9.]/g, '');
      const value = parseFloat(cleaned);
      if (!Number.isNaN(value) && value > 0) prices.push(value);
    }
    console.log('[sold-scraper] prices found with s-item__price regex:', prices.length);

    // FALLBACK: if the class selector above finds nothing (sign that eBay changed
    // their CSS class names again), try looking directly for generic price patterns
    // in format "$123.45" or "$1,234.56" anywhere in the HTML body.
    // Less precise (may catch shipping/filter prices too), but better than failing.
    if (!prices.length) {
      const genericPriceRegex = />\s*\$\s?([0-9][0-9,]*\.[0-9]{2})\s*</g;
      let gMatch;
      while ((gMatch = genericPriceRegex.exec(html)) !== null) {
        const cleaned = gMatch[1].replace(/,/g, '');
        const value = parseFloat(cleaned);
        if (!Number.isNaN(value) && value > 0) prices.push(value);
      }
      console.log('[sold-scraper] fallback: prices found with generic $xx.xx pattern:', prices.length);
    }

    // TEMPORARY DIAGNOSTICS: if 0 prices found, show HTML snippets around dollar signs.
    // Early occurrences are usually sidebar filters ("Under $15.00" etc.), not real listings.
    // We grab occurrences 8-12 which are more likely to be in the actual product listing area.
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
      console.log('[sold-scraper] DIAGNOSTIC: total $ occurrences found (max 15 logged):', dollarIndices.length);

      // Show snippets around occurrences 8-12 (index 7-11)
      for (let i = 7; i <= 11 && i < dollarIndices.length; i++) {
        const idx = dollarIndices[i];
        console.log(`[sold-scraper] DIAGNOSTIC snippet around $ #${i + 1}:`, html.slice(Math.max(0, idx - 250), idx + 50));
      }

      // Check for captcha/blocking signs from eBay
      if (
        lowerHtml.includes('captcha') ||
        lowerHtml.includes('pardon our interruption') ||
        lowerHtml.includes('are you a human')
      ) {
        console.log('[sold-scraper] DIAGNOSTIC: CAPTCHA/block page detected — not a real search results page.');
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
            'Scraper was called successfully but 0 prices were parsed. eBay may have changed their HTML structure — check/update the CSS selector in sold-scraper.js, or verify the scraper API is returning valid HTML.',
        }),
      };
    }

    const avgSold = prices.reduce((a, b) => a + b, 0) / prices.length;
    console.log('[sold-scraper] SUCCESS, avgSoldPrice:', avgSold.toFixed(2));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        available: true,
        soldCount: prices.length,
        avgSoldPrice: Number(avgSold.toFixed(2)),
        minSoldPrice: Math.min(...prices),
        maxSoldPrice: Math.max(...prices),
        note: 'This is a snapshot of current sold listings (not a 12-month historical trend). For long-term seasonal charts, this data would need to be saved to a database daily/weekly — see README under "Further Development".',
      }),
    };
  } catch (err) {
    console.log('[sold-scraper] ERROR caught:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
