// netlify/functions/ai-insight.js
//
// POST /api/ai-insight
// Body: { query: string, stats: <objek stats dari /api/ebay-search> }
//
// Fungsi ini mengirim data REAL (stats agregat dari listing eBay aktif) ke
// DeepSeek, lalu meminta DeepSeek menganalisis -- bukan mengarang data baru.
// Hasilnya dipakai untuk mengisi Dashboard Overview & Strategy Center.
//
// ============================================================
// GANTI BAGIAN INI kalau mau pindah provider AI (OpenAI, Claude, dll):
// cukup ganti AI_BASE_URL, MODEL, dan header Authorization sesuai dokumentasi
// provider tersebut -- body request (messages, response_format) kemungkinan
// besar formatnya sama karena kebanyakan provider kompatibel format OpenAI.
// ============================================================
const AI_BASE_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-v4-flash'; // ganti 'deepseek-v4-pro' untuk kualitas analisis lebih tinggi (lebih mahal)

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY belum diisi di Netlify Environment Variables.');
    }

    const { query, stats } = JSON.parse(event.body || '{}');
    if (!stats) {
      return { statusCode: 400, body: JSON.stringify({ error: 'stats wajib dikirim (hasil dari /api/ebay-search).' }) };
    }

    const systemPrompt =
      'Anda adalah analis riset pasar eBay yang berpengalaman. Anda diberi data AGREGAT REAL dari listing aktif eBay (bukan data rekaan). Tugas Anda HANYA menganalisis data yang diberikan, jangan mengarang angka baru yang tidak ada dasarnya. Jawab HANYA dalam JSON valid, tanpa markdown, tanpa teks pembuka.';

    const userPrompt = `Produk yang dicari: "${query}"

Data agregat REAL dari eBay (listing aktif saat ini):
${JSON.stringify(stats, null, 2)}

Berdasarkan data di atas, hasilkan JSON dengan struktur PERSIS seperti ini:
{
  "opportunityScore": 0,
  "entryBarrierScore": 0,
  "competitionScore": 0,
  "demandScore": 0,
  "profitabilityScore": 0,
  "growthPotentialScore": 0,
  "marketSummary": "2-3 kalimat ringkasan pasar",
  "productHealthIndicator": "Sehat | Waspada | Berisiko",
  "recommendedAction": "1 kalimat aksi konkret",
  "insights": ["insight 1", "insight 2", "insight 3", "insight 4", "insight 5"],
  "actionPlans": ["rencana 1", "rencana 2", "rencana 3", "rencana 4", "rencana 5"],
  "finalRecommendation": "Buy | Test Small | Avoid",
  "finalRecommendationReason": "2-3 kalimat alasan",
  "optimizedTitle": "contoh judul listing eBay yang dioptimasi, maksimal 80 karakter"
}

Semua skor dalam skala 0-100. Pastikan competitionScore & entryBarrierScore konsisten dengan top3SellerShare dan uniqueSellers pada data (top3SellerShare tinggi + uniqueSellers rendah = pasar dikuasai sedikit seller = entry barrier & competition tinggi). Gunakan Bahasa Indonesia untuk semua teks.`;

    const res = await fetch(AI_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DeepSeek API error (status ${res.status}): ${errText}`);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
