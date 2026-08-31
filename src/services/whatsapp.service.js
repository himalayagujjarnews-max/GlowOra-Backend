/**
 * WhatsApp Cloud API (Meta) — used to send booking reminders alongside the
 * existing push notifications (see notification.service.js). This is a
 * best-effort channel: reminders should never fail/block on WhatsApp being
 * down or unconfigured.
 *
 * IMPORTANT — WhatsApp template requirement: because reminders are sent
 * outside a live user-initiated chat session ("proactive" messages), Meta
 * requires a pre-APPROVED message template (created in Meta Business
 * Manager > WhatsApp Manager > Message Templates) rather than free-form
 * text. `sendWhatsAppTemplate` sends by template name + ordered body
 * variables — create a template there first, e.g.:
 *
 *   Name: booking_reminder
 *   Category: Marketing (or Utility, if it qualifies)
 *   Body: "Hi {{1}}! You left a booking at {{2}} unfinished. Come back and
 *          grab your slot before it's gone. 💇"
 *   (2 body variables: customer name, salon name)
 *
 * Until WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID are set in the env,
 * this silently no-ops (dev console-log), same convention as utils/otp.js's
 * sendSms falling back when Twilio/MSG91 aren't configured.
 */
const axios = require('axios');
const config = require('../config/env');
const logger = require('../utils/logger');

const whatsappEnabled = Boolean(config.whatsapp.apiToken && config.whatsapp.phoneNumberId);

/**
 * @param {string} phone - 10-digit Indian mobile number (no country code)
 * @param {string} templateName - name of an APPROVED template in WhatsApp Manager
 * @param {string[]} bodyParams - ordered values for the template's {{1}}, {{2}}, ... placeholders
 */
async function sendWhatsAppTemplate(phone, templateName, bodyParams = []) {
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) return { skipped: 'invalid_phone' };

  if (!whatsappEnabled) {
    logger.info(`📱 [DEV] WhatsApp "${templateName}" to ${phone} — params: ${JSON.stringify(bodyParams)} (WHATSAPP_API_TOKEN not set)`);
    return { dev: true };
  }

  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: `91${phone}`,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: bodyParams.length
        ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })) }]
        : [],
    },
  };

  try {
    const { data } = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${config.whatsapp.apiToken}`, 'Content-Type': 'application/json' },
    });
    return data;
  } catch (e) {
    // Never let a WhatsApp failure break the caller's flow (e.g. the
    // abandoned-cart reminder cron) — log and move on, push notification
    // already covers the same reminder.
    logger.error(`WhatsApp send failed for ${phone} (${templateName}): ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
    return { error: true };
  }
}

module.exports = { sendWhatsAppTemplate, whatsappEnabled };
