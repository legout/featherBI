SELECT station, product, CAST(inspected_on AS DATE) AS inspected_on, amount, successful, CASE WHEN successful THEN 1 ELSE 0 END AS success_value
FROM inspections
