/**
 * Email sending via nodemailer (SMTP).
 * In dev without SMTP configured, the email/OTP is logged to the console
 * instead of being sent — so the whole flow works with zero setup.
 */
const nodemailer = require('nodemailer');
const config = require('../config/env');
const logger = require('./logger');

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendEmail(to, subject, html) {
  if (!transporter) {
    logger.info(`📧 [DEV] Email to ${to} — ${subject}`);
    return { dev: true };
  }
  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'GlowOra <no-reply@glowora.life>',
    to, subject, html,
  });
}

async function sendEmailOtp(email, otp) {
  const subject = 'Your GlowOra verification code';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#0e7c7b">GlowOra</h2>
      <p>Your verification code is:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#16302f">${otp}</p>
      <p style="color:#8a9a99">This code expires in a few minutes. If you didn't request it, ignore this email.</p>
    </div>`;
  if (!transporter) {
    console.log('\n============================================');
    console.log(`  📧  DEV EMAIL OTP for ${email}  =  ${otp}`);
    console.log('============================================\n');
    logger.info(`📧 [DEV] Email OTP for ${email} is ${otp} (SMTP not configured)`);
    return { dev: true };
  }
  return sendEmail(email, subject, html);
}

module.exports = { sendEmail, sendEmailOtp };
