-- query.sql — Three meaningful JOIN / GROUP BY reports

-- 1) User ride history by month
SELECT u.user_id, u.name AS user_name,
       DATE_TRUNC('month', r.start_ts) AS month,
       COUNT(*) AS rides,
       SUM(r.total_amount) AS total_spent
FROM ride r
JOIN app_user u ON u.user_id = r.user_id
GROUP BY u.user_id, u.name, DATE_TRUNC('month', r.start_ts)
ORDER BY user_id, month;

-- 2) Driver earnings by month (gross, commission, net)
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

-- 3) Company revenue by category & start zone
SELECT c.name AS category,
       r.start_zone,
       COUNT(*) AS rides,
       SUM(r.total_amount) AS revenue,
       SUM(r.tax_amount) AS tax_collected
FROM ride r
JOIN category c ON c.cat_id = r.cat_id
GROUP BY c.name, r.start_zone
ORDER BY c.name, r.start_zone;
