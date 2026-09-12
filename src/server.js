require('dotenv').config();
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const pi = require('./piClient');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PLAN_PRICES = { weekly: 5, monthly: 9, yearly: 15 };
const PLAN_DURATION_DAYS = { weekly: 7, monthly: 30, yearly: 365 };

app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 30 }));

function computeNewExpiry(existingExpiresAt, plan) {
  const now = new Date();
  const base = existingExpiresAt && new Date(existingExpiresAt) > now ? new Date(existingExpiresAt) : now;
  return new Date(base.getTime() + PLAN_DURATION_DAYS[plan] * 86400000).toISOString();
}

function subscriptionView(row) {
  if (!row) return null;
  return { plan: row.plan, expiresAt: row.expires_at, active: new Date(row.expires_at) > new Date() };
}

async function applyCompletedPayment({ paymentId, piUid, username, plan, amount, txid }) {
  const existing = db.getSubscription(piUid);
  const expiresAt = computeNewExpiry(existing && existing.expires_at, plan);
  db.upsertSubscription({ piUid, username, plan, expiresAt });
  db.recordPayment({ paymentId, piUid, plan, amount, status: 'completed', txid });
  return subscriptionView({ plan, expires_at: expiresAt });
}

app.post('/api/subscription-status', async (req, res) => {
  try {
    const { accessToken } = req.body || {};
    if (!accessToken) return res.status(400).json({ error: 'accessToken required' });
    const user = await pi.verifyUser(accessToken);
    res.json({ uid: user.uid, username: user.username, subscription: subscriptionView(db.getSubscription(user.uid)) });
  } catch (e) {
    res.status(401).json({ error: 'Could not verify user', detail: e.message });
  }
});

app.post('/api/payments/approve', async (req, res) => {
  try {
    const { accessToken, paymentId } = req.body || {};
    if (!accessToken || !paymentId) return res.status(400).json({ error: 'accessToken and paymentId required' });

    const user = await pi.verifyUser(accessToken);
    const payment = await pi.getPayment(paymentId);

    if (payment.user_uid !== user.uid) {
      return res.status(403).json({ error: 'Payment does not belong to this user' });
    }
    const plan = payment.metadata && payment.metadata.plan;
    const expectedPrice = PLAN_PRICES[plan];
    if (!expectedPrice || Number(payment.amount) !== expectedPrice) {
      return res.status(400).json({ error: 'Unrecognized plan or amount does not match the price list' });
    }

    await pi.approvePayment(paymentId);
    db.recordPayment({ paymentId, piUid: user.uid, plan, amount: payment.amount, status: 'approved' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Approval failed', detail: e.message });
  }
});

app.post('/api/payments/complete', async (req, res) => {
  try {
    const { accessToken, paymentId, txid } = req.body || {};
    if (!accessToken || !paymentId || !txid) {
      return res.status(400).json({ error: 'accessToken, paymentId and txid required' });
    }

    const user = await pi.verifyUser(accessToken);
    const completed = await pi.completePayment(paymentId, txid);

    if (completed.user_uid !== user.uid) {
      return res.status(403).json({ error: 'Payment does not belong to this user' });
    }
    const plan = completed.metadata && completed.metadata.plan;
    if (!PLAN_DURATION_DAYS[plan]) {
      return res.status(400).json({ error: 'Unrecognized plan' });
    }

    const subscription = await applyCompletedPayment({
      paymentId, piUid: user.uid, username: user.username, plan, amount: completed.amount, txid
    });
    res.json({ ok: true, subscription });
  } catch (e) {
    res.status(500).json({ error: 'Completion failed', detail: e.message });
  }
});

app.post('/api/payments/incomplete', async (req, res) => {
  try {
    const { paymentId } = req.body || {};
    if (!paymentId) return res.status(400).json({ error: 'paymentId required' });

    const payment = await pi.getPayment(paymentId);
    if (payment.status.developer_completed) {
      return res.json({ ok: true, note: 'already completed' });
    }

    if (payment.transaction && payment.transaction.txid) {
      const completed = await pi.completePayment(paymentId, payment.transaction.txid);
      const plan = completed.metadata && completed.metadata.plan;
      if (PLAN_DURATION_DAYS[plan]) {
        await applyCompletedPayment({
          paymentId, piUid: completed.user_uid, username: null, plan, amount: completed.amount, txid: payment.transaction.txid
        });
      }
    } else {
      await pi.cancelPayment(paymentId);
      db.recordPayment({
        paymentId, piUid: payment.user_uid, plan: payment.metadata && payment.metadata.plan,
        amount: payment.amount, status: 'cancelled'
      });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not resolve incomplete payment', detail: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dhaki backend listening on port ${PORT}`));
