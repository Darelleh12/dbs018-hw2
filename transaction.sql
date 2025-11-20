-- transaction.sql — Main OLTP transaction for RideShare
-- This block mirrors our bookAndPay() logic in server.js.
-- It books a ride and processes payment atomically:
--   1) Look up category pricing
--   2) Compute price_before_tax, tax_amount, total_amount
--   3) Find user bank account and company bank account
--   4) Insert payment row
--   5) Debit user account and credit company account
--   6) Insert ride row with totals and payment_id
--   7) Insert company_commission row (currently 20% of total_amount)

BEGIN;

-- Inputs (named parameters for clarity):
--   :user_id      INT
--   :driver_id    INT
--   :vehicle_id   INT
--   :cat_id       INT
--   :start_zone   VARCHAR
--   :end_zone     VARCHAR
--   :distance_km  NUMERIC
--   :method       VARCHAR (e.g. 'Card')

WITH pricing AS (
  SELECT base_fare, per_km
  FROM category
  WHERE cat_id = :cat_id
),
totals AS (
  SELECT
    (SELECT base_fare FROM pricing)
      + (SELECT per_km FROM pricing) * :distance_km AS price_before_tax
),
taxed AS (
  SELECT
    price_before_tax,
    ROUND(price_before_tax * 0.08, 2) AS tax_amount,
    ROUND(price_before_tax * 1.08, 2) AS total_amount
  FROM totals
),
comp AS (
  SELECT acct_id AS company_acct
  FROM bank_account
  WHERE owner_type = 'COMPANY'
  ORDER BY acct_id
  LIMIT 1
),
uacct AS (
  SELECT acct_id AS user_acct, balance
  FROM bank_account
  WHERE owner_type = 'USER'
    AND owner_id = :user_id
  ORDER BY acct_id
  LIMIT 1
),
pay AS (
  INSERT INTO payment(user_id, acct_id, method, amount)
  SELECT
    :user_id,
    (SELECT user_acct FROM uacct),
    :method,
    (SELECT total_amount FROM taxed)
  RETURNING payment_id
),
debit_user AS (
  UPDATE bank_account
  SET balance = balance - (SELECT total_amount FROM taxed)
  WHERE acct_id = (SELECT user_acct FROM uacct)
),
credit_company AS (
  UPDATE bank_account
  SET balance = balance + (SELECT total_amount FROM taxed)
  WHERE acct_id = (SELECT company_acct FROM comp)
),
ins_ride AS (
  INSERT INTO ride(
    user_id, driver_id, vehicle_id, cat_id,
    start_zone, end_zone, distance_km,
    price_before_tax, tax_amount, total_amount,
    status, payment_id
  )
  SELECT
    :user_id, :driver_id, :vehicle_id, :cat_id,
    :start_zone, :end_zone, :distance_km,
    (SELECT price_before_tax FROM taxed),
    (SELECT tax_amount FROM taxed),
    (SELECT total_amount FROM taxed),
    'PAID',
    (SELECT payment_id FROM pay)
  RETURNING ride_id, total_amount
)
INSERT INTO company_commission(ride_id, driver_id, commission_amt)
SELECT ride_id,
       :driver_id,
       ROUND(total_amount * 0.20, 2)
FROM ins_ride;

COMMIT;
