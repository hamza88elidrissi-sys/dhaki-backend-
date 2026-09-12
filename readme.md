# Dhaki backend

Implements the Server-Side Approval and Server-Side Completion steps that Pi
Network requires for User-to-App payments, and is now the single source of
truth for subscription status. The frontend no longer decides for itself
whether a user is subscribed — it asks this server, which checks Pi's own
records and a local database.

## What changed vs. the client-only version

- `/api/approve` and `/api/complete` are real endpoints now, not 404s.
- Every payment is double-checked server-side: the Pi access token is
  verified with Pi's servers, the payment's `user_uid` must match that user,
  and the amount must match the price list — a modified client can no longer
  grant itself a subscription for less than it paid, or for free.
- Subscription status is stored in a small SQLite database keyed by the
  user's Pi UID, not in browser local storage.
- Payments the SDK reports as "incomplete" (e.g. the app was closed
  mid-payment) are now resolved automatically instead of being ignored.

## Setup

1. **Get an API key.** In the [Pi Developer Portal](https://develop.pi/),
   open your app and copy its API key. Testnet and Mainnet have separate
   keys — use the one matching the `sandbox` flag your frontend calls
   `Pi.init()` with (currently `sandbox: true`, i.e. Testnet).
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Configure environment:**
   ```bash
   cp .env.example .env
   # then edit .env and set PI_API_KEY
   ```
4. **Run it:**
   ```bash
   npm start
   ```
   This serves the Dhaki frontend (`public/index.html`) *and* the API from
   the same origin on `PORT` (default `3000`), so there's no CORS setup to
   deal with.
5. **Deploy** somewhere with a public HTTPS URL (Pi apps are loaded over
   HTTPS in the Pi Browser), and register that URL in the Developer Portal.

## Endpoints

| Route | Called when | Does |
|---|---|---|
| `POST /api/subscription-status` | On login | Verifies the access token via Pi's `/me`, returns the caller's current plan/expiry/active flag |
| `POST /api/payments/approve` | `onReadyForServerApproval` | Verifies user + payment ownership + price, then approves with Pi |
| `POST /api/payments/complete` | `onReadyForServerCompletion` | Completes with Pi, extends/creates the subscription, returns the new status |
| `POST /api/payments/incomplete` | `onIncompletePaymentFound` | Re-fetches the payment from Pi and completes or cancels it |

## Data

SQLite (`better-sqlite3`), file path set by `DATABASE_PATH`. Two tables:

- `subscriptions` — one row per Pi user: current plan, expiry, last update.
- `payments` — an audit trail of every approved/completed/cancelled payment,
  keyed by Pi's `payment_id`.

SQLite is fine at this stage (testnet, low volume). If Dhaki grows past what
a single file can comfortably handle, swap `src/db.js` for a Postgres/MySQL
client — every other file only calls the four functions it exports
(`getSubscription`, `upsertSubscription`, `recordPayment`,
`getPaymentRecord`), so the rest of the app doesn't need to change.

## Notes

- A basic rate limit (30 requests/minute/IP) is applied to `/api/*` — cheap
  insurance against someone hammering the endpoints, tune it in
  `src/server.js` if it's too strict for your testing.
- This backend does **not** need your app's wallet private seed — that's
  only required for App-to-User payments (refunds, payouts), which aren't
  implemented here.
- Never commit `.env` or expose `PI_API_KEY` to the frontend; only the
  `Authorization: Bearer <user access token>` scheme is safe client-side.
  
