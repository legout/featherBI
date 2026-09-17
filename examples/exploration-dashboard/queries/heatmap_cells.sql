SELECT station,
       CASE WHEN amount <= 4 THEN 'low' WHEN amount <= 8 THEN 'mid' ELSE 'high' END AS band,
       sum(amount) AS total
FROM inspection_model
GROUP BY station, band
ORDER BY station, band
