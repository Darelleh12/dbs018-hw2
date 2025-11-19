-- transaction.sql — Phase 1 core
-- Book a ride and pay, atomically:
-- 1) compute price
-- 2) insert payment
-- 3) debit user account, credit company account
-- 4) insert ride with totals and payment_id
-- 5) insert company_commission (20%)

BEGIN;

-- Inputs (example):
-- :user_id, :driver_id, :vehicle_id, :cat_id, :start_zone, :end_zone, :distance_km, :method

WITH pricing AS (
  SELECT base_fare, per_km FROM category WHERE cat_id = :cat_id
), comp AS (
  SELECT acct_id AS company_acct FROM bank_account WHERE owner_type='COMPANY' ORDER BY acct_id LIMIT 1
), uacct AS (
  SELECT acct_id AS user_acct, balance FROM bank_account WHERE owner_type='USER' AND owner_id = :user_id ORDER BY acct_id LIMIT 1
), totals AS (
  SELECT
    (SELECT base_fare FROM pricing) + (SELECT per_km FROM pricing) * :distance_km AS price_before_tax
), taxed AS (
  SELECT price_before_tax,
         ROUND(price_before_tax * 0.08, 2) AS tax_amount,
         ROUND(price_before_tax * 1.08, 2) AS total_amount
  FROM totals
), pay AS (
  INSERT INTO payment(user_id, acct_id, method, amount)
  SELECT :user_id, (SELECT user_acct FROM uacct), :method, (SELECT total_amount FROM taxed)
  RETURNING payment_id
), debit AS (
  UPDATE bank_account
    SET balance = balance - (SELECT total_amount FROM taxed)
    WHERE acct_id = (SELECT user_acct FROM uacct)
  RETURNING acct_id
), credit AS (
  UPDATE bank_account
    SET balance = balance + (SELECT total_amount FROM taxed)
    WHERE acct_id = (SELECT company_acct FROM comp)
  RETURNING acct_id
), ins_ride AS (
  INSERT INTO ride(user_id, driver_id, vehicle_id, cat_id, start_zone, end_zone, distance_km,
                   price_before_tax, tax_amount, total_amount, status, payment_id)
  SELECT :user_id, :driver_id, :vehicle_id, :cat_id, :start_zone, :end_zone, :distance_km,
         (SELECT price_before_tax FROM taxed), (SELECT tax_amount FROM taxed), (SELECT total_amount FROM taxed),
         'PAID', (SELECT payment_id FROM pay)
  RETURNING ride_id, total_amount
)
INSERT INTO company_commission(ride_id, driver_id, commission_amt)
SELECT ride_id, :driver_id, ROUND(total_amount * 0.20, 2)
FROM ins_ride;

COMMIT;
