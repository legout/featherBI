SELECT CAST(inspection_date AS VARCHAR) AS inspection_date, order_number, product_mlfb, test_station_identifier, source, sequence_number, G0003, is_last_measurement
FROM ap
WHERE ($date_from IS NULL OR CAST(inspection_date AS DATE) >= $date_from) AND ($date_to IS NULL OR CAST(inspection_date AS DATE) < $date_to) AND ($source IS NULL OR source = $source) AND ($station IS NULL OR test_station_identifier = $station) AND ($product IS NULL OR product_mlfb = $product) AND ($order IS NULL OR order_number = $order)
ORDER BY inspection_date DESC, order_number, sequence_number NULLS LAST
