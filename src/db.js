const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'dhaki.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    pi_uid     TEXT PRIMARY KEY,
    username   TEXT,
    plan       TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    payment_id TEXT PRIMARY KEY,
    pi_uid     TEXT,
    plan       TEXT,
    amount     REAL,
    status     TEXT NOT NULL,
    txid       TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function getSubscription(piUid) {
  return db.prepare('SELECT * FROM subscriptions WHERE pi_uid = ?').get(piUid) || null;
}

function upsertSubscription({ piUid, username, plan, expiresAt }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO subscriptions (pi_uid, username, plan, expires_at, updated_at)
    VALUES (@piUid, @username, @plan, @expiresAt, @now)
    ON CONFLICT(pi_uid) DO UPDATE SET
      username = @username, plan = @plan, expires_at = @expiresAt, updated_at = @now
  `).run({ piUid, username: username || null, plan, expiresAt, now });
}

function recordPayment({ paymentId, piUid, plan, amount, status, txid }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO payments (payment_id, pi_uid, plan, amount, status, txid, created_at, updated_at)
    VALUES (@paymentId, @piUid, @plan, @amount, @status, @txid, @now, @now)
    ON CONFLICT(payment_id) DO UPDATE SET
      status = @status, txid = @txid, updated_at = @now
  `).run({ paymentId, piUid: piUid || null, plan: plan || null, amount: amount || null, status, txid: txid || null, now });
}

function getPaymentRecord(paymentId) {
  return db.prepare('SELECT * FROM payments WHERE payment_id = ?').get(paymentId) || null;
}

module.exports = { getSubscription, upsertSubscription, recordPayment, getPaymentRecord };
