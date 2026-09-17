SELECT G0003 AS code, count(*) AS records
FROM ap
WHERE G0003 IS NOT NULL AND ($date_from IS NULL OR CAST(inspection_date AS DATE) >= $date_from) AND ($date_to IS NULL OR CAST(inspection_date AS DATE) < $date_to) AND ($source IS NULL OR source = $source) AND ($station IS NULL OR test_station_identifier = $station) AND ($product IS NULL OR product_mlfb = $product) AND ($order IS NULL OR order_number = $order)
GROUP BY code
ORDER BY records DESC, code
