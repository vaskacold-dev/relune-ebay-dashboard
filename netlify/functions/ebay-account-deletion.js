// netlify/functions/ebay-account-deletion.js
//
// REQUIRED endpoint for eBay "Marketplace Account Deletion / Closure Notifications".
// This is not a dashboard feature — it is a compliance requirement from the eBay
// Developer Program so your API key (Production Keyset) stays "Compliant" and usable.
//
// How it works (per eBay's official spec):
//   1) When you save this endpoint in the eBay Developer Portal, eBay immediately
//      sends a GET request with ?challenge_code=xxxx for verification.
//      The endpoint must respond with JSON { challengeResponse: <hash> } where:
//      hash = SHA-256( challengeCode + verificationToken + endpointURL ), in hex.
//   2) After passing verification, whenever an eBay user requests account deletion,
//      eBay sends a POST to this endpoint. You MUST respond with status 200 quickly
//      (eBay doesn't care about the response body — just the 200 status. Repeated
//      failures will cause eBay to mark the endpoint "down" and send warning emails
//      to the address registered in your developer account).
//
// Required ENV VARS (set in Netlify → Site configuration → Environment variables):
//   EBAY_VERIFICATION_TOKEN  -> a string you create yourself, 32-80 characters,
//                               letters/numbers/underscores/hyphens. MUST EXACTLY MATCH
//                               what you enter in the "Verification token" field on the
//                               eBay Developer Portal form.
//
// Final endpoint URL (enter in "Marketplace account deletion notification endpoint"):
//   https://<your-netlify-site-name>.netlify.app/api/ebay-account-deletion
//
// The main dashboard is NOT affected by this file in any way — this is purely an
// administrative requirement to keep your eBay API key fully active (compliant status).

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
        body: JSON.stringify({ error: 'Parameter challenge_code not found.' }),
      };
    }

    if (!verificationToken) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'EBAY_VERIFICATION_TOKEN is not set in Netlify Environment Variables.',
        }),
      };
    }

    // eBay requires the endpoint URL to be EXACTLY the same as what you registered
    // in the Developer Portal (including https://, no trailing slash, no query string).
    // Set via EBAY_ENDPOINT_URL env var to avoid hardcoding and allow easy updates
    // if the domain changes.
    const endpointUrl = process.env.EBAY_ENDPOINT_URL;

    if (!endpointUrl) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'EBAY_ENDPOINT_URL is not set in Netlify Environment Variables (must exactly match the URL registered in eBay Developer Portal).',
        }),
      };
    }

    // Concatenation order REQUIRED by eBay: challengeCode + verificationToken + endpoint
    // (this order is defined by eBay and must not be changed)
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
  // STEP 2: Actual notification (POST request) when eBay user deletes account
  // -------------------------------------------------------------------
  if (event.httpMethod === 'POST') {
    try {
      const payload = JSON.parse(event.body || '{}');

      // This dashboard does not store any personal data from any eBay user (it only
      // calls the public Browse API for market research), so there is nothing to delete
      // on our end. We just log for audit trail, then respond 200 so eBay considers
      // the notification successfully received.
      console.log('Marketplace account deletion notification received:', JSON.stringify(payload));

      // If in the future this dashboard stores data related to specific eBay users
      // (e.g. in a database), add data deletion logic here using:
      // payload.notification.data.username / userId

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received: true }),
      };
    } catch (err) {
      // Still respond 200 — eBay only needs confirmation the endpoint is alive.
      // Don't let a parse error cause eBay to mark the endpoint "down".
      console.error('Failed to parse eBay payload:', err.message);
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
    body: JSON.stringify({ error: 'Method not allowed. Use GET (verification) or POST (notification).' }),
  };
};
