/**
 * Provider adapter placeholder. Swap in Africa's Talking / Safaricom / Infobip, etc.
 */
async function sendSmsViaProvider({ toPhone, body }) {
  console.log('[SMS PROVIDER SIMULATION] Sending to', toPhone, '::', body);
  return {
    messageId: 'SIM_' + Date.now(),
    status: 'SENT',
  };
}

module.exports = {
  sendSmsViaProvider,
};
