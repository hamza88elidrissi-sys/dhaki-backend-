// Thin wrapper around the Pi Platform API (https://api.minepi.com/v2).
//
// Two auth schemes are used, per Pi's docs:
//   - "Bearer <user access token>"  -> user-scoped endpoints (GET /me)
//   - "Key <server API key>"        -> server-only endpoints (payments)
// The server API key must NEVER be sent to, or accepted from, the browser.

const PI_API_BASE = 'https://api.minepi.com/v2';

function requireApiKey() {
  const key = process.env.PI_API_KEY;
  if (!key) throw new Error('PI_API_KEY is not set in the environment');
  return key;
}

async function piFetch(path, { method = 'GET', bearer, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  headers.Authorization = bearer ? `Bearer ${bearer}` : `Key ${requireApiKey()}`;

  const res = await fetch(`${PI_API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(`Pi API ${method} ${path} failed with ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Verifies a user's access token with Pi's servers and returns their identity ({ uid, username, ... }). */
function verifyUser(accessToken) {
  return piFetch('/me', { bearer: accessToken });
}

/** Fetches the authoritative payment record from Pi's servers. Always prefer this over trusting a client-supplied payment object. */
function getPayment(paymentId) {
  return piFetch(`/payments/${paymentId}`);
}

/** Server-Side Approval: tells Pi it's safe to let the user sign and submit the transaction. */
function approvePayment(paymentId) {
  return piFetch(`/payments/${paymentId}/approve`, { method: 'POST' });
}

/** Server-Side Completion: acknowledges the submitted blockchain transaction and finalizes the payment. */
function completePayment(paymentId, txid) {
  return piFetch(`/payments/${paymentId}/complete`, { method: 'POST', body: { txid } });
}

/** Cancels a payment that was created but should not proceed (e.g. found incomplete with no transaction). */
function cancelPayment(paymentId) {
  return piFetch(`/payments/${paymentId}/cancel`, { method: 'POST' });
}

module.exports = { verifyUser, getPayment, approvePayment, completePayment, cancelPayment };
