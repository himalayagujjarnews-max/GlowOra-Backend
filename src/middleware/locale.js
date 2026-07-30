/**
 * i18n / localisation context — resolves the request's locale, currency,
 * and timezone from headers (or user prefs), for a future international rollout.
 * Attaches req.ctx = { locale, currency, timezone, country }.
 */
const config = require('../config/env');

module.exports = function locale(req, res, next) {
  const hdrLocale = (req.headers['accept-language'] || '').split(',')[0].split('-')[0];
  const locale = config.supportedLocales.includes(hdrLocale)
    ? hdrLocale
    : (req.user && req.user.language) || config.defaults.locale;

  const reqCurrency = req.headers['x-currency'];
  const currency = config.supportedCurrencies.includes(reqCurrency) ? reqCurrency : config.defaults.currency;

  req.ctx = {
    locale,
    currency,
    timezone: req.headers['x-timezone'] || config.defaults.timezone,
    country: req.headers['x-country'] || config.defaults.country,
  };
  res.setHeader('Content-Language', locale);
  next();
};
