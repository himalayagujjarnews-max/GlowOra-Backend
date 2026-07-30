/**
 * Standard success response shape:
 *   { success: true, message, data }
 */
function sendResponse(res, statusCode, message, data = null, meta = null) {
  const body = { success: true, message };
  if (data !== null) body.data = data;
  if (meta !== null) body.meta = meta;
  return res.status(statusCode).json(body);
}

module.exports = sendResponse;
