WITH grouped AS (
    SELECT product_mlfb, count(*) AS records
    FROM ap
    WHERE ($date_from IS NULL OR CAST(inspection_date AS DATE) >= $date_from) AND ($date_to IS NULL OR CAST(inspection_date AS DATE) < $date_to) AND ($source IS NULL OR source = $source) AND ($station IS NULL OR test_station_identifier = $station) AND ($product IS NULL OR product_mlfb = $product) AND ($order IS NULL OR order_number = $order)
    GROUP BY product_mlfb
), ranked AS (
    SELECT product_mlfb, records, row_number() OVER (ORDER BY records DESC, product_mlfb NULLS LAST) AS rn
    FROM grouped
), bucketed AS (
    SELECT CASE WHEN rn <= 10 THEN COALESCE(product_mlfb, '(missing product)') ELSE 'Other products' END AS product, records
    FROM ranked
)
SELECT product, CAST(sum(records) AS BIGINT) AS records
FROM bucketed
GROUP BY product
ORDER BY records DESC, product
