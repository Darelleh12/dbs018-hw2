// server.js — PostgreSQL implementation with transactions + reports
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { faker } = require("@faker-js/faker");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Utility to run a single SQL and optionally return rows; also collect SQL for "trace"
async function runSQL(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return { rows: res.rows, rowCount: res.rowCount };
  } finally {
    client.release();
  }
}

// DDL: create tables (idempotent: drops then creates)
const ddl = `
DROP TABLE IF EXISTS company_commission CASCADE;
DROP TABLE IF EXISTS ride CASCADE;
DROP TABLE IF EXISTS payment CASCADE;
DROP TABLE IF EXISTS bank_account CASCADE;
DROP TABLE IF EXISTS vehicle CASCADE;
DROP TABLE IF EXISTS driver CASCADE;
DROP TABLE IF EXISTS category CASCADE;
DROP TABLE IF EXISTS app_user CASCADE;

CREATE TABLE app_user (
  user_id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(120) UNIQUE NOT NULL,
  phone VARCHAR(30)
);

CREATE TABLE category (
  cat_id SERIAL PRIMARY KEY,
  name VARCHAR(30) UNIQUE NOT NULL,
  base_fare NUMERIC(8,2) NOT NULL CHECK (base_fare >= 0),
  per_km NUMERIC(8,2) NOT NULL CHECK (per_km >= 0)
);

CREATE TABLE driver (
  driver_id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  license_no VARCHAR(30) UNIQUE NOT NULL,
  rating NUMERIC(2,1) CHECK (rating BETWEEN 0 AND 5)
);

CREATE TABLE vehicle (
  vehicle_id SERIAL PRIMARY KEY,
  driver_id INT NOT NULL REFERENCES driver(driver_id) ON DELETE CASCADE,
  plate VARCHAR(15) UNIQUE NOT NULL,
  make VARCHAR(40),
  model VARCHAR(40),
  year INT,
  capacity INT CHECK (capacity >= 1),
  cat_id INT NOT NULL REFERENCES category(cat_id)
);

CREATE TABLE bank_account (
  acct_id SERIAL PRIMARY KEY,
  owner_type VARCHAR(10) NOT NULL CHECK (owner_type IN ('USER','DRIVER','COMPANY')),
  owner_id INT NOT NULL,
  balance NUMERIC(14,2) NOT NULL CHECK (balance >= 0)
);

CREATE TABLE payment (
  payment_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES app_user(user_id),
  acct_id INT NOT NULL REFERENCES bank_account(acct_id),
  method VARCHAR(20) NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  ts TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX payment_user_idx ON payment(user_id);
CREATE INDEX payment_acct_idx ON payment(acct_id);

CREATE TABLE ride (
  ride_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES app_user(user_id),
  driver_id INT NOT NULL REFERENCES driver(driver_id),
  vehicle_id INT NOT NULL REFERENCES vehicle(vehicle_id),
  cat_id INT NOT NULL REFERENCES category(cat_id),
  start_zone VARCHAR(60) NOT NULL,
  end_zone VARCHAR(60) NOT NULL,
  start_ts TIMESTAMP NOT NULL DEFAULT NOW(),
  end_ts TIMESTAMP,
  distance_km NUMERIC(8,2) CHECK (distance_km >= 0),
  price_before_tax NUMERIC(12,2) CHECK (price_before_tax >= 0),
  tax_amount NUMERIC(12,2) CHECK (tax_amount >= 0),
  total_amount NUMERIC(12,2) CHECK (total_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'BOOKED',
  rating INT CHECK (rating BETWEEN 1 AND 5),
  payment_id INT REFERENCES payment(payment_id)
);

CREATE INDEX ride_user_idx ON ride(user_id);
CREATE INDEX ride_driver_idx ON ride(driver_id);

CREATE TABLE company_commission (
  ride_id INT NOT NULL REFERENCES ride(ride_id) ON DELETE CASCADE,
  driver_id INT NOT NULL REFERENCES driver(driver_id) ON DELETE CASCADE,
  commission_amt NUMERIC(12,2) NOT NULL CHECK (commission_amt >= 0),
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (ride_id, driver_id)
);
`;

// Seed lookup data: >= 10 rows for categories, and create default accounts
async function initLookups() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert 10 users
    for (let i = 0; i < 10; i++) {
      await client.query(
        `INSERT INTO app_user(name,email,phone) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING`,
        [
          faker.person.fullName(),
          faker.internet.email().toLowerCase(),
          faker.phone.number(),
        ]
      );
    }

    // Insert 10 drivers
    for (let i = 0; i < 10; i++) {
      await client.query(
        `INSERT INTO driver(name,license_no,rating) VALUES ($1,$2,$3) ON CONFLICT (license_no) DO NOTHING`,
        [
          faker.person.fullName(),
          faker.string.alphanumeric(10).toUpperCase(),
          (Math.random() * 2 + 3).toFixed(1),
        ]
      );
    }

    // Insert 10 categories
    const cats = [
      "Economy",
      "Premium",
      "SUV",
      "Luxury",
      "Mini",
      "Pool",
      "XL",
      "Electric",
      "Hybrid",
      "Business",
    ];
    for (const c of cats) {
      await client.query(
        `INSERT INTO category(name,base_fare,per_km) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING`,
        [
          c,
          (Math.random() * 5 + 3).toFixed(2),
          (Math.random() * 1.5 + 0.5).toFixed(2),
        ]
      );
    }

    // Insert vehicles (at least 10) and map to drivers/cats
    const { rows: drivers } = await client.query(
      `SELECT driver_id FROM driver ORDER BY driver_id LIMIT 10`
    );
    const { rows: categories } = await client.query(
      `SELECT cat_id FROM category ORDER BY cat_id LIMIT 10`
    );
    for (let i = 0; i < 10; i++) {
      const d = drivers[i % drivers.length].driver_id;
      const c = categories[i % categories.length].cat_id;
      await client.query(
        `INSERT INTO vehicle(driver_id, plate, make, model, year, capacity, cat_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          d,
          faker.string.alphanumeric(7).toUpperCase(),
          faker.vehicle.manufacturer(),
          faker.vehicle.model(),
          2015 + (i % 9),
          4 + (i % 3),
          c,
        ]
      );
    }

    // Bank accounts: 10 users, 10 drivers, 1 company
    const { rows: users } = await client.query(
      `SELECT user_id FROM app_user ORDER BY user_id LIMIT 10`
    );
    for (const u of users) {
      await client.query(
        `INSERT INTO bank_account(owner_type, owner_id, balance) VALUES ('USER',$1,$2)`,
        [u.user_id, (Math.random() * 3000 + 1000).toFixed(2)]
      );
    }
    for (const d of drivers) {
      await client.query(
        `INSERT INTO bank_account(owner_type, owner_id, balance) VALUES ('DRIVER',$1,$2)`,
        [d.driver_id, (Math.random() * 2000 + 500).toFixed(2)]
      );
    }
    // company account
    await client.query(
      `INSERT INTO bank_account(owner_type, owner_id, balance) VALUES ('COMPANY', 1, 0)`
    );

    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Transaction: Book ride + payment + bank debit (Phase 1 core)
// This mirrors sql/transaction.sql
async function bookAndPay({
  user_id,
  driver_id,
  vehicle_id,
  cat_id,
  start_zone,
  end_zone,
  distance_km,
  method,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Pricing
    const { rows: cat } = await client.query(
      `SELECT base_fare, per_km FROM category WHERE cat_id = $1`,
      [cat_id]
    );
    if (!cat.length) throw new Error("Invalid category");
    const base = Number(cat[0].base_fare);
    const perkm = Number(cat[0].per_km);
    const price_before_tax = base + perkm * Number(distance_km);
    const tax_amount = Number((price_before_tax * 0.08).toFixed(2));
    const total_amount = Number((price_before_tax + tax_amount).toFixed(2));
    const commission = Number((total_amount * 0.2).toFixed(2)); // ✅ NEW

    // Company account id
    const { rows: comp } = await client.query(
      `SELECT acct_id FROM bank_account WHERE owner_type='COMPANY' ORDER BY acct_id LIMIT 1`
    );
    const company_acct = comp[0].acct_id;

    // User account id
    const { rows: uacct } = await client.query(
      `SELECT acct_id,balance FROM bank_account WHERE owner_type='USER' AND owner_id=$1 ORDER BY acct_id LIMIT 1`,
      [user_id]
    );
    if (!uacct.length) throw new Error("User account missing");
    if (Number(uacct[0].balance) < total_amount)
      throw new Error("Insufficient user balance");
    const user_acct = uacct[0].acct_id;

    // Insert payment
    const payRes = await client.query(
      `INSERT INTO payment(user_id, acct_id, method, amount) VALUES ($1,$2,$3,$4) RETURNING payment_id`,
      [user_id, user_acct, method || "Card", total_amount]
    );
    const payment_id = payRes.rows[0].payment_id;

    // Debit user, credit company
    await client.query(
      `UPDATE bank_account SET balance = balance - $1 WHERE acct_id = $2`,
      [total_amount, user_acct]
    );
    await client.query(
      `UPDATE bank_account SET balance = balance + $1 WHERE acct_id = $2`,
      [total_amount, company_acct]
    );

    // Insert ride
    const rideRes = await client.query(
      `INSERT INTO ride(user_id, driver_id, vehicle_id, cat_id, start_zone, end_zone, distance_km, price_before_tax, tax_amount, total_amount, status, payment_id)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PAID',$11) RETURNING ride_id`,
      [
        user_id,
        driver_id,
        vehicle_id,
        cat_id,
        start_zone,
        end_zone,
        distance_km,
        price_before_tax,
        tax_amount,
        total_amount,
        payment_id,
      ]
    );
    const ride_id = rideRes.rows[0].ride_id;

    // Commission 20%
    await client.query(
      `INSERT INTO company_commission(ride_id, driver_id, commission_amt, paid)
   VALUES ($1,$2,$3,FALSE)`,
      [ride_id, driver_id, commission]
    );

    // AUTO-RATE (1–5)
    await autoRateRide(ride_id, client);

    await client.query("COMMIT");
    return {
      ok: true,
      ride_id,
      payment_id,
      price_before_tax,
      tax_amount,
      total_amount,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Reports
// 1) User ride history by month (JOIN + GROUP BY)
const REPORT_1 = `
  SELECT u.user_id, u.name AS user_name,
         DATE_TRUNC('month', r.start_ts) AS month,
         COUNT(*) AS rides,
         SUM(r.total_amount) AS total_spent
  FROM ride r
  JOIN app_user u ON u.user_id = r.user_id
  GROUP BY u.user_id, u.name, DATE_TRUNC('month', r.start_ts)
  ORDER BY user_id, month;
`;

// 2) Driver earnings (gross, commission, net) by month
const REPORT_2 = `
  SELECT d.driver_id, d.name AS driver_name,
         DATE_TRUNC('month', r.start_ts) AS month,
         SUM(r.total_amount) AS gross,
         COALESCE(SUM(cc.commission_amt),0) AS commission,
         SUM(r.total_amount) - COALESCE(SUM(cc.commission_amt),0) AS net
  FROM ride r
  JOIN driver d ON d.driver_id = r.driver_id
  LEFT JOIN company_commission cc ON cc.ride_id = r.ride_id AND cc.driver_id = d.driver_id
  GROUP BY d.driver_id, d.name, DATE_TRUNC('month', r.start_ts)
  ORDER BY driver_id, month;
`;

// 3) Company revenue by category and zone
const REPORT_3 = `
  SELECT c.name AS category,
         r.start_zone,
         COUNT(*) AS rides,
         SUM(r.total_amount) AS revenue,
         SUM(r.tax_amount) AS tax_collected
  FROM ride r
  JOIN category c ON c.cat_id = r.cat_id
  GROUP BY c.name, r.start_zone
  ORDER BY c.name, r.start_zone;
`;

const REPORT_4 = `
  SELECT
    d.driver_id,
    d.name AS driver_name,
    d.rating AS avg_rating,
    COUNT(r.ride_id) AS rated_rides
  FROM driver d
  LEFT JOIN ride r
    ON r.driver_id = d.driver_id
   AND r.rating IS NOT NULL
  GROUP BY d.driver_id, d.name, d.rating
  ORDER BY d.rating DESC NULLS LAST, d.driver_id;
`;

app.post("/create-tables", async (req, res) => {
  try {
    await runSQL(ddl);
    res.json({ ok: true, message: "Tables created." });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/init-lookups", async (req, res) => {
  try {
    const result = await initLookups();
    res.json({ ok: true, message: "Lookups initialized." });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/browse/:table", async (req, res) => {
  const { table } = req.params;
  const limit = Number(req.query.limit || 10);
  try {
    const { rows } = await runSQL(
      `SELECT * FROM ${table} ORDER BY 1 LIMIT $1`,
      [limit]
    );
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/sql", async (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing q query parameter" });
  }

  // Tiny safety: only allow SELECT
  const trimmed = q.trim().toLowerCase();
  if (!trimmed.startsWith("select")) {
    return res
      .status(400)
      .json({ ok: false, error: "Only SELECT statements are allowed" });
  }

  try {
    const { rows } = await runSQL(q);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/simulate", async (req, res) => {
  const n = Math.min(Number(req.body.n || 100), 1000);

  const client = await pool.connect();
  let users, vehicles;
  try {
    const uRes = await client.query(`SELECT user_id FROM app_user`);
    const vRes = await client.query(
      `SELECT vehicle_id, cat_id, driver_id FROM vehicle`
    );
    users = uRes.rows;
    vehicles = vRes.rows;
  } catch (e) {
    client.release();
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }

  if (!users.length || !vehicles.length) {
    return res.status(400).json({
      ok: false,
      error: "Need users and vehicles before simulation. Click Init Lookups.",
    });
  }

  // Build N concurrent transactions
  const tasks = [];
  const startTime = Date.now();

  for (let i = 0; i < n; i++) {
    const u = users[i % users.length].user_id;
    const v = vehicles[i % vehicles.length];
    const d = v.driver_id;
    const c = v.cat_id;
    const km = Number((Math.random() * 15 + 1).toFixed(2));
    const startZone = faker.location.city();
    const endZone = faker.location.city();

    tasks.push(
      bookAndPay({
        user_id: u,
        driver_id: d,
        vehicle_id: v.vehicle_id,
        cat_id: c,
        start_zone: startZone,
        end_zone: endZone,
        distance_km: km,
        method: "Card",
      })
    );
  }

  // Run them concurrently
  const results = await Promise.allSettled(tasks);
  const totalTimeMs = Date.now() - startTime;

  let success = 0;
  let failed = 0;
  results.forEach((r) => {
    if (r.status === "fulfilled") success++;
    else failed++;
  });

  const avgTimeMs = success ? totalTimeMs / success : 0;

  res.json({
    ok: true,
    inserted: success,
    failed,
    totalTimeMs,
    avgTimeMs,
  });
});

app.post("/frontdesk/book", async (req, res) => {
  const startTime = Date.now();
  try {
    const payload =
      req.body && Object.keys(req.body).length
        ? req.body
        : {
            user_id: 1,
            driver_id: 1,
            vehicle_id: 1,
            cat_id: 1,
            start_zone: "Downtown",
            end_zone: "Airport",
            distance_km: 12.3,
            method: "Card",
          };
    const result = await bookAndPay(payload);
    const executionTime = Date.now() - startTime;
    res.json({ ok: true, result, executionTime });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/frontdesk/custom-ride", async (req, res) => {
  const startTime = Date.now();
  const { user_id, driver_id, start_zone, end_zone } = req.body || {};

  if (!user_id || !driver_id || !start_zone || !end_zone) {
    return res.status(400).json({
      ok: false,
      error:
        "user_id, driver_id, start_zone, and end_zone are required for a custom ride",
    });
  }

  const client = await pool.connect();
  try {
    // Validate user exists
    const u = await client.query(
      "SELECT user_id FROM app_user WHERE user_id = $1",
      [user_id]
    );
    if (!u.rows.length) {
      client.release();
      return res.status(400).json({ ok: false, error: "User not found" });
    }

    // Find a vehicle for this driver
    const v = await client.query(
      "SELECT vehicle_id, cat_id FROM vehicle WHERE driver_id = $1 ORDER BY vehicle_id LIMIT 1",
      [driver_id]
    );
    if (!v.rows.length) {
      client.release();
      return res
        .status(400)
        .json({ ok: false, error: "Driver not found or has no vehicle" });
    }

    const vehicle_id = v.rows[0].vehicle_id;
    const cat_id = v.rows[0].cat_id;

    // Fixed distance for simplicity (you can randomize if you want)
    const distance_km = 12.3;

    const payload = {
      user_id: Number(user_id),
      driver_id: Number(driver_id),
      vehicle_id,
      cat_id,
      start_zone,
      end_zone,
      distance_km,
      method: "Card",
    };

    client.release();

    const result = await bookAndPay(payload);
    const executionTime = Date.now() - startTime;
    res.json({ ok: true, result, executionTime });
  } catch (e) {
    client.release();
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/delete-all-data", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Delete in order (respecting foreign key constraints)
    await client.query("DELETE FROM company_commission");
    await client.query("DELETE FROM ride");
    await client.query("DELETE FROM payment");
    await client.query("DELETE FROM bank_account");
    await client.query("DELETE FROM vehicle");
    await client.query("DELETE FROM driver");
    await client.query("DELETE FROM app_user");
    await client.query("DELETE FROM category");

    //Reset auto-increment counters so IDs start from 1 again
    await client.query("ALTER SEQUENCE app_user_user_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE driver_driver_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE category_cat_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE vehicle_vehicle_id_seq RESTART WITH 1");
    await client.query(
      "ALTER SEQUENCE bank_account_acct_id_seq RESTART WITH 1"
    );
    await client.query("ALTER SEQUENCE payment_payment_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE ride_ride_id_seq RESTART WITH 1");

    await client.query("COMMIT");
    res.json({ ok: true, message: "All data deleted successfully" });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.get("/report/1", async (req, res) => {
  try {
    const { rows } = await runSQL(REPORT_1);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/report/2", async (req, res) => {
  try {
    const { rows } = await runSQL(REPORT_2);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/report/3", async (req, res) => {
  try {
    const { rows } = await runSQL(REPORT_3);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/report/4", async (req, res) => {
  try {
    const { rows } = await runSQL(REPORT_4);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/recent/rides", async (req, res) => {
  // default: last 10 minutes, cap at 1440 (1 day)
  const minutes = Math.max(1, Math.min(Number(req.query.minutes || 10), 1440));

  const sql = `
    SELECT
      r.ride_id,
      r.user_id,
      r.driver_id,
      r.start_zone,
      r.end_zone,
      r.total_amount,
      r.start_ts,
      p.payment_id,
      p.amount AS payment_amount,
      p.ts AS payment_ts
    FROM ride r
    LEFT JOIN payment p ON r.payment_id = p.payment_id
    WHERE r.start_ts >= NOW() - $1 * INTERVAL '1 minute'
    ORDER BY r.start_ts DESC
    LIMIT 50;
  `;

  try {
    const { rows } = await runSQL(sql, [minutes]);
    res.json({ ok: true, rows, minutes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.post("/ride/rate", async (req, res) => {
  const { ride_id, rating } = req.body || {};

  const numericRating = Number(rating);
  if (!ride_id || !Number.isFinite(numericRating)) {
    return res
      .status(400)
      .json({ ok: false, error: "ride_id and numeric rating are required" });
  }
  if (numericRating < 1 || numericRating > 5) {
    return res
      .status(400)
      .json({ ok: false, error: "Rating must be between 1 and 5" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const rideRes = await client.query(
      "SELECT driver_id FROM ride WHERE ride_id = $1",
      [ride_id]
    );
    if (!rideRes.rows.length) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(400).json({ ok: false, error: "Ride not found" });
    }

    const driver_id = rideRes.rows[0].driver_id;

    // Store rating on the ride
    await client.query("UPDATE ride SET rating = $2 WHERE ride_id = $1", [
      ride_id,
      numericRating,
    ]);

    // Recompute driver's average rating from all rated rides
    const avgRes = await client.query(
      "SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating FROM ride WHERE driver_id = $1 AND rating IS NOT NULL",
      [driver_id]
    );
    const avgRating = avgRes.rows[0].avg_rating || 0;

    await client.query("UPDATE driver SET rating = $2 WHERE driver_id = $1", [
      driver_id,
      avgRating,
    ]);

    await client.query("COMMIT");
    client.release();

    res.json({
      ok: true,
      ride_id,
      driver_id,
      rating: numericRating,
      driver_rating: avgRating,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    client.release();
    res.status(500).json({ ok: false, error: e.message });
  }
});
async function autoRateRide(ride_id, client) {
  const rating = Math.floor(Math.random() * 5) + 1; // 1–5

  // Get driver for this ride
  const rideRes = await client.query(
    "SELECT driver_id FROM ride WHERE ride_id = $1",
    [ride_id]
  );
  if (!rideRes.rows.length) return; // should never happen

  const driver_id = rideRes.rows[0].driver_id;

  // Store rating
  await client.query("UPDATE ride SET rating = $2 WHERE ride_id = $1", [
    ride_id,
    rating,
  ]);

  // Recompute driver avg
  const avgRes = await client.query(
    "SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating FROM ride WHERE driver_id = $1 AND rating IS NOT NULL",
    [driver_id]
  );
  const avgRating = avgRes.rows[0].avg_rating || 0;

  await client.query("UPDATE driver SET rating = $2 WHERE driver_id = $1", [
    driver_id,
    avgRating,
  ]);
}

app.post("/backend/pay-driver", async (req, res) => {
  const driverId = Number(req.body.driver_id);
  if (!driverId) {
    return res.status(400).json({ ok: false, error: "driver_id required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Company account
    const compRes = await client.query(
      `SELECT acct_id FROM bank_account
       WHERE owner_type = 'COMPANY'
       ORDER BY acct_id LIMIT 1`
    );
    if (!compRes.rows.length) throw new Error("Company account missing");
    const company_acct = compRes.rows[0].acct_id;

    // Driver account
    const dRes = await client.query(
      `SELECT acct_id FROM bank_account
       WHERE owner_type = 'DRIVER' AND owner_id = $1
       ORDER BY acct_id LIMIT 1`,
      [driverId]
    );
    if (!dRes.rows.length) throw new Error("Driver account missing");
    const driver_acct = dRes.rows[0].acct_id;

    // Sum all unpaid commission for this driver
    const sumRes = await client.query(
      `SELECT COALESCE(SUM(commission_amt),0) AS total
       FROM company_commission
       WHERE driver_id = $1 AND paid = FALSE`,
      [driverId]
    );
    const total = Number(sumRes.rows[0].total);

    if (total <= 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.json({
        ok: true,
        driver_id: driverId,
        paid: 0,
        message: "No unpaid commission",
      });
    }

    // Move money: company -> driver
    await client.query(
      `UPDATE bank_account SET balance = balance - $1 WHERE acct_id = $2`,
      [total, company_acct]
    );
    await client.query(
      `UPDATE bank_account SET balance = balance + $1 WHERE acct_id = $2`,
      [total, driver_acct]
    );

    // Mark commissions as paid
    await client.query(
      `UPDATE company_commission
       SET paid = TRUE
       WHERE driver_id = $1 AND paid = FALSE`,
      [driverId]
    );

    await client.query("COMMIT");
    client.release();

    res.json({
      ok: true,
      driver_id: driverId,
      paid: total,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    client.release();
    res.status(500).json({ ok: false, error: e.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`🚀 Server running on http://localhost:${port}`)
);
