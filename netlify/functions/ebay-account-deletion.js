// netlify/functions/ebay-account-deletion.js
//
// Endpoint WAJIB untuk eBay "Marketplace Account Deletion / Closure Notifications".
// Ini bukan fitur dashboard -- ini syarat compliance dari eBay Developer Program
// agar API key (Production Keyset) kamu berstatus "Compliant" dan bisa dipakai.
//
// Cara kerja (sesuai spesifikasi resmi eBay):
//   1) Saat kamu menyimpan endpoint ini di eBay Developer Portal, eBay akan
//      langsung kirim GET request berisi ?challenge_code=xxxx untuk verifikasi.
//      Endpoint harus balas JSON { challengeResponse: <hash> } dengan hash =
//      SHA-256( challengeCode + verificationToken + endpointURL ), dalam hex.
//   2) Setelah lolos verifikasi, setiap kali ada user yang request hapus akun
//      eBay mereka, eBay akan kirim POST ke endpoint ini. Kamu WAJIB balas
//      status 200 dalam waktu singkat (eBay tidak peduli isi body-nya, yang
//      penting status 200 -- kalau gagal terus, eBay akan menandai endpoint
//      "down" dan mengirim email peringatan ke alamat yang kamu daftarkan).
//
// ENV VARS yang dibutuhkan (isi di Netlify -> Site configuration -> Environment variables):
//   EBAY_VERIFICATION_TOKEN  -> string bebas buatanmu sendiri, 32-80 karakter,
//                               huruf/angka/underscore/hyphen. HARUS SAMA PERSIS
//                               dengan yang kamu ketik di field "Verification token"
//                               pada form eBay Developer Portal (lihat screenshot kamu).
//
// URL endpoint final (isi di field "Marketplace account deletion notification endpoint"):
//   https://<nama-site-netlify-kamu>.netlify.app/api/ebay-account-deletion
//
// Dashboard utama TIDAK terpengaruh apa pun oleh file ini -- ini cuma syarat
// administratif supaya eBay API key-mu aktif penuh (status compliant).

const crypto = require('crypto');

exports.handler = async function (event) {
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN;

  // -------------------------------------------------------------------
  // STEP 1: eBay verification challenge (GET request)
  // -------------------------------------------------------------------
  if (event.httpMethod === 'GET') {
    const challengeCode = (event.queryStringParameters || {}).challenge_code;

    if (!challengeCode) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Parameter challenge_code tidak ditemukan.' }),
      };
    }

    if (!verificationToken) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'EBAY_VERIFICATION_TOKEN belum diisi di Netlify Environment Variables.',
        }),
      };
    }

    // eBay menentukan endpoint URL ini harus PERSIS sama dengan yang kamu
    // daftarkan di Developer Portal (termasuk https://, tanpa trailing slash
    // tambahan, tanpa query string). Set via env var ENDPOINT_URL supaya
    // tidak perlu hardcode dan mudah diganti kalau domain berubah.
    const endpointUrl = process.env.EBAY_ENDPOINT_URL;

    if (!endpointUrl) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'EBAY_ENDPOINT_URL belum diisi di Netlify Environment Variables (harus persis sama dengan URL yang didaftarkan di eBay Developer Portal).',
        }),
      };
    }

    // Urutan penggabungan WAJIB: challengeCode + verificationToken + endpoint
    // (urutan ini ditentukan eBay, tidak boleh diubah)
    const hash = crypto.createHash('sha256');
    hash.update(challengeCode);
    hash.update(verificationToken);
    hash.update(endpointUrl);
    const challengeResponse = hash.digest('hex');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeResponse }),
    };
  }

  // -------------------------------------------------------------------
  // STEP 2: Notifikasi aktual (POST request) saat user hapus akun eBay
  // -------------------------------------------------------------------
  if (event.httpMethod === 'POST') {
    try {
      const payload = JSON.parse(event.body || '{}');

      // Dashboard ini tidak menyimpan data pribadi user eBay manapun (hanya
      // memanggil Browse API publik untuk riset pasar), jadi tidak ada data
      // yang perlu dihapus dari sisi kita. Kita cukup log untuk jejak audit,
      // lalu balas 200 supaya eBay menganggap notifikasi berhasil diterima.
      console.log('Marketplace account deletion notification diterima:', JSON.stringify(payload));

      // Kalau di masa depan dashboard ini menyimpan data terkait user eBay
      // tertentu (misal di database), tambahkan logika penghapusan data di sini,
      // menggunakan payload.notification.data.username / userId.

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received: true }),
      };
    } catch (err) {
      // Tetap balas 200 -- eBay hanya butuh konfirmasi endpoint hidup,
      // jangan sampai error parsing membuat eBay menandai endpoint "down".
      console.error('Gagal parse payload eBay:', err.message);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received: true }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method not allowed. Gunakan GET (verifikasi) atau POST (notifikasi).' }),
  };
};
