SELECT station, sum(amount) AS amount
FROM inspection_model
WHERE ($station_filter IS NULL OR json_contains($station_filter, to_json(station)))
GROUP BY station
ORDER BY station
