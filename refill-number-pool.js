/**
 * Ops script — NOT called by the app at request time.
 * Run manually or on a schedule (e.g. weekly cron) to keep number_pool
 * stocked. Buys new SignalWire numbers and assigns them to your existing
 * approved TCR campaign, so they're instantly usable when handed to a
 * merchant later (see services/numberProvisioning.js).
 *
 * Usage: node scripts/refill-number-pool.js --count 10
 *
 * Requires env vars:
 *   SIGNALWIRE_PROJECT_ID, SIGNALWIRE_API_TOKEN, SIGNALWIRE_SPACE_URL
 *   SIGNALWIRE_CAMPAIGN_SID  — your already-approved TCR campaign SID
 */
require('dotenv').config();
const { RestClient } = require('@signalwire/compatibility-api');
const pool = require('../src/db/pool');

const client = new RestClient(
  process.env.SIGNALWIRE_PROJECT_ID,
  process.env.SIGNALWIRE_API_TOKEN,
  { signalwireSpaceUrl: process.env.SIGNALWIRE_SPACE_URL }
);

// The Campaign Registry endpoints are not exposed by @signalwire/compatibility-api
// (that package only mirrors Twilio's messaging/voice API, not TCR). We call
// this one directly with fetch() + HTTP Basic Auth, per SignalWire's docs:
// https://signalwire.com/docs/apis/rest/campaign-registry/phone-number-assignments/create-order
async function assignNumberToCampaign(phoneNumber, campaignSid) {
  const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;
  const auth = Buffer.from(`${process.env.SIGNALWIRE_PROJECT_ID}:${process.env.SIGNALWIRE_API_TOKEN}`).toString('base64');

  const response = await fetch(
    `https://${spaceUrl}/api/relay/rest/registry/beta/campaigns/${campaignSid}/orders`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ phone_numbers: [phoneNumber] }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Campaign assignment failed for ${phoneNumber}: ${response.status} ${text}`);
  }

  return response.json();
}

async function refill(count) {
  const campaignSid = process.env.SIGNALWIRE_CAMPAIGN_SID;
  if (!campaignSid) {
    throw new Error('SIGNALWIRE_CAMPAIGN_SID is not set — register/approve a campaign first.');
  }

  for (let i = 0; i < count; i++) {
    // 1. Buy an available local number (adjust areaCode/params to your needs).
    const purchased = await client.incomingPhoneNumbers.create({
      areaCode: process.env.DEFAULT_AREA_CODE || undefined,
      smsUrl: process.env.SMS_WEBHOOK_URL, // e.g. https://yourapp.com/webhooks/sms
    });

    // 2. Assign it to the approved campaign so messaging is enabled.
    //    Per SignalWire docs, this can take up to ~24h to fully process on
    //    the carrier side — that's fine, it happens here in the pool,
    //    not while a merchant is waiting on signup. The order will show as
    //    "Pending" or "Failed" until it flips to "Processed".
    await assignNumberToCampaign(purchased.phoneNumber, campaignSid);

    await pool.query(
      `INSERT INTO number_pool (phone_number, status, campaign_sid) VALUES ($1, 'available', $2)`,
      [purchased.phoneNumber, campaignSid]
    );

    console.log(`Added ${purchased.phoneNumber} to pool and submitted campaign assignment order.`);
  }
}

const countArg = process.argv.indexOf('--count');
const count = countArg !== -1 ? parseInt(process.argv[countArg + 1], 10) : 5;

refill(count)
  .then(() => { console.log('Done.'); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
