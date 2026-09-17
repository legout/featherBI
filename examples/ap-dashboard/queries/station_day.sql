SELECT CAST(CAST(date_trunc('day', inspection_date) AS DATE) AS VARCHAR) AS day, test_station_identifier AS station, count(*) AS records
FROM ap
WHERE ($date_from IS NULL OR CAST(inspection_date AS DATE) >= $date_from) AND ($date_to IS NULL OR CAST(inspection_date AS DATE) < $date_to) AND ($source IS NULL OR source = $source) AND ($station IS NULL OR test_station_identifier = $station) AND ($product IS NULL OR product_mlfb = $product) AND ($order IS NULL OR order_number = $order)
GROUP BY day, station
ORDER BY day, station
