// netlify/functions/ebay-search.js
//
// GET /api/ebay-search?q=<product name>&condition=ALL|NEW|USED&marketplace=US|UK|GLOBAL
//
// This function calls the eBay Browse API (ACTIVE listing data, real-time, official).
// Nothing needs to be changed here — just make sure EBAY_CLIENT_ID & EBAY_CLIENT_SECRET
// are set in Netlify Environment Variables (see README.md).
//
// IMPORTANT (read README): eBay does NOT provide an official API for "sold" data.
// The Browse API only returns data for currently active listings.
// All figures in this function's response (avgPrice, histogram, etc.) are calculated
// from ASKING PRICES of active listings, NOT final sold prices.

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAppToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry - 60000) {
    return cachedToken; // still valid, saves an API call
  }

  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set. Go to Netlify Dashboard -> Site configuration -> Environment variables.'
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch eBay token (status ${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = now + data.expires_in * 1000;
  return cachedToken;
}

const MARKETPLACE_MAP = {
  US: ['EBAY_US'],
  UK: ['EBAY_GB'],
  GLOBAL: ['EBAY_US', 'EBAY_GB', 'EBAY_DE'],
};

// Official eBay condition IDs: 1000=New, 3000=Used
const CONDITION_MAP = {
  NEW: '1000',
  USED: '3000',
  ALL: null,
};

async function searchOneMarketplace(token, marketplaceId, query, conditionId) {
  const params = new URLSearchParams({ q: query, limit: '50' });
  if (conditionId) {
    params.set('filter', `conditionIds:{${conditionId}}`);
  }

  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    // In GLOBAL mode: one marketplace failing should not fail everything.
    return [];
  }

  const data = await res.json();
  return data.itemSummaries || [];
}

function buildStats(items) {
  if (!items.length) return null;

  const prices = items
    .map((i) => parseFloat(i.price?.value))
    .filter((p) => !Number.isNaN(p))
    .sort((a, b) => a - b);

  if (!prices.length) return null;

  const sum = prices.reduce((a, b) => a + b, 0);
  const avg = sum / prices.length;
  const median = prices[Math.floor(prices.length / 2)];
  const min = prices[0];
  const max = prices[prices.length - 1];

  const bucketCount = 6;
  const bucketSize = (max - min) / bucketCount || 1;
  const histogram = Array.from({ length: bucketCount }, (_, idx) => {
    const bucketMin = min + idx * bucketSize;
    const bucketMax = bucketMin + bucketSize;
    const count = prices.filter(
      (p) => p >= bucketMin && (idx === bucketCount - 1 ? p <= bucketMax + 0.001 : p < bucketMax)
    ).length;
    return { range: `$${bucketMin.toFixed(0)}-${bucketMax.toFixed(0)}`, count };
  });

  const auctionCount = items.filter((i) => (i.buyingOptions || []).includes('AUCTION')).length;
  const binCount = items.length - auctionCount;

  const sellerMap = new Map();
  items.forEach((i) => {
    const username = i.seller?.username || 'unknown';
    if (!sellerMap.has(username)) {
      sellerMap.set(username, {
        username,
        count: 0,
        feedbackScore: i.seller?.feedbackScore || 0,
        feedbackPercentage: i.seller?.feedbackPercentage || null,
      });
    }
    sellerMap.get(username).count += 1;
  });
  const sellers = Array.from(sellerMap.values()).sort((a, b) => b.count - a.count);
  const topSellers = sellers.slice(0, 10);
  const top3Share = sellers.length
    ? sellers.slice(0, 3).reduce((acc, s) => acc + s.count, 0) / items.length
    : 0;

  // Basic Keyword Intelligence: word frequency from REAL listing titles.
  const stopwords = new Set([
    'the', 'and', 'for', 'with', 'new', 'used', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'lot', 'set',
  ]);
  const wordCount = new Map();
  items.forEach((i) => {
    const words = (i.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
    words.forEach((w) => {
      if (w.length < 3 || stopwords.has(w)) return;
      wordCount.set(w, (wordCount.get(w) || 0) + 1);
    });
  });
  const topKeywords = Array.from(wordCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));

  return {
    totalActiveListings: items.length,
    uniqueSellers: sellers.length,
    avgPrice: Number(avg.toFixed(2)),
    medianPrice: Number(median.toFixed(2)),
    minPrice: Number(min.toFixed(2)),
    maxPrice: Number(max.toFixed(2)),
    histogram,
    binCount,
    auctionCount,
    topSellers,
    top3SellerShare: Number((top3Share * 100).toFixed(1)),
    topKeywords,
  };
}

exports.handler = async function (event) {
  try {
    const params = event.queryStringParameters || {};
    const query = (params.q || '').trim();
    const condition = (params.condition || 'ALL').toUpperCase();
    const marketplace = (params.marketplace || 'US').toUpperCase();

    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Parameter q (product name) is required.' }),
      };
    }

    const token = await getAppToken();
    const marketplaceIds = MARKETPLACE_MAP[marketplace] || MARKETPLACE_MAP.US;
    const conditionId = CONDITION_MAP[condition];

    const resultsPerMarket = await Promise.all(
      marketplaceIds.map((mp) => searchOneMarketplace(token, mp, query, conditionId))
    );
    const items = resultsPerMarket.flat();

    const seen = new Set();
    const uniqueItems = items.filter((i) => {
      if (seen.has(i.itemId)) return false;
      seen.add(i.itemId);
      return true;
    });

    const stats = buildStats(uniqueItems);

    const listings = uniqueItems.slice(0, 60).map((i) => ({
      itemId: i.itemId,
      title: i.title,
      price: i.price?.value ? Number(i.price.value) : null,
      currency: i.price?.currency || 'USD',
      condition: i.condition,
      buyingOptions: i.buyingOptions,
      seller: {
        username: i.seller?.username,
        feedbackScore: i.seller?.feedbackScore,
        feedbackPercentage: i.seller?.feedbackPercentage,
      },
      image: i.image?.imageUrl,
      itemWebUrl: i.itemWebUrl, // direct link to the product on eBay (used by frontend to open on click)
      itemLocationCountry: i.itemLocation?.country,
      shippingCost: i.shippingOptions?.[0]?.shippingCost?.value ?? null,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, condition, marketplace, stats, listings }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
