/* eslint-disable no-console */
require('dotenv').config();
const { runAutoDraftForDate, nairobiDateISO } = require('../server/services/autoDraftPayouts.service');

async function main() {
  if (String(process.env.FEATURE_AUTO_DRAFT_PAYOUTS || '').toLowerCase() !== 'true') {
    console.log('FEATURE_AUTO_DRAFT_PAYOUTS disabled; exiting.');
    return;
  }

  const dateArg = process.argv[2] || null;
  const settlementDate = nairobiDateISO(dateArg);
  console.log(`Running auto-draft payouts for ${settlementDate}...`);

  const summary = await runAutoDraftForDate({ settlementDate });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('Auto-draft payouts failed:', err);
  process.exitCode = 1;
});

