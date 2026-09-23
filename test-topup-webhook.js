// Simulates a Creem "checkout.completed" top-up webhook hitting your local
// server, with a correctly-computed signature — so you can verify the whole
// /webhooks/creem -> applyTopup -> usage_quota pipeline without waiting on
// a real Creem payment.
//
// Usage:
//   node scripts/test-topup-webhook.js <merchantId> [packs]
//
// Example:
//   node scripts/test-topup-webhook.js cc94c7f3-4ccf-45cd-a33b-13126a970f90 1

require('dotenv').config();
const crypto = require('crypto');

const merchantId = process.argv[2];
const packs = process.argv[3] || '1';

if (!merchantId) {
  console.error('Usage: node scripts/test-topup-webhook.js <merchantId> [packs]');
  process.exit(1);
}

const secret = process.env.CREEM_WEBHOOK_SECRET;
if (!secret) {
  console.error('CREEM_WEBHOOK_SECRET is not set in .env — the webhook will reject this with 401.');
  process.exit(1);
}

const event = {
  eventType: 'checkout.completed',
  object: {
    id: `test_checkout_${Date.now()}`, // unique each run, so re-running isn't blocked by the idempotency check
    metadata: {
      purpose: 'topup',
      merchant_id: merchantId,
      packs: String(packs),
    },
  },
};

const rawBody = Buffer.from(JSON.stringify(event));
const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

const port = process.env.PORT || 3000;

fetch(`http://localhost:${port}/webhooks/creem`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'creem-signature': signature,
  },
  body: rawBody,
})
  .then(async (res) => {
    console.log('HTTP status:', res.status);
    console.log('Body:', await res.text());
  })
  .catch((err) => {
    console.error('Request failed:', err.message);
  });