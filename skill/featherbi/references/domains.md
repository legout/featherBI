# Domain playbooks

Index for brainstorming mode (`references/brainstorm.md`). Match the profile against the detection signals, then read only that playbook. A row exists only when its playbook file exists; copy `references/domains/_template.md` to add one.

| Domain | Detection signals | Playbook |
|---|---|---|
| Sensor time series | `ts`/`timestamp` column plus a `sensor`/`device` id and numeric readings (`temp_c`, `value`) at a fixed interval | [sensor-time-series](domains/sensor-time-series.md) |
| End-of-line test | `serial`, `station`, `result` = PASS/FAIL, `fail_code`, `meas_*` with `lsl`/`usl` limits; one row per unit test | [end-of-line-test](domains/end-of-line-test.md) |
| SPC / quality | `subgroup`/`sample` number, repeated measurements of one characteristic (`diameter_mm`), a sampling time; subgroups of 3–10 | [spc-quality](domains/spc-quality.md) |
| OEE and downtime | machine, shift date, planned/run minutes, produced/scrap counts, or stop rows with `start`, `end`, `reason` | [oee-downtime](domains/oee-downtime.md) |
| Energy / smart meter | `meter` id, interval timestamp (15 min or hourly), `kwh`/`kw` per interval or a cumulative register | [energy-smart-meter](domains/energy-smart-meter.md) |
| Sales / e-commerce | an order id, an order date, `revenue`/`amount`, `units`, `channel`, `category`; one row per order line | [sales-ecommerce](domains/sales-ecommerce.md) |
| SaaS subscriptions | `customer`/`account`, `plan`, `mrr`/`price`, start date, `status` active/churned or a cancel date | [saas-subscriptions](domains/saas-subscriptions.md) |
| Web / product analytics | `session_id`/`visitor`, a day, `source`/`referrer`, `pages`/`events`, a `converted` flag | [web-product-analytics](domains/web-product-analytics.md) |
| Stock OHLCV | `ticker`/`symbol`, a trading day, `open`, `high`, `low`, `close`, often `volume`; one row per ticker per day | [stock-ohlcv](domains/stock-ohlcv.md) |
| Accounting plan / actual | `plan`/`budget` and `actual` amounts, a `dept`/`cost_center`, an `account`, a `month` | [accounting-plan-actual](domains/accounting-plan-actual.md) |
| Weather | `station`/`city`, a day, `temp_c`, `precip_mm`, maybe `wind`/`humidity`; one row per station per day | [weather](domains/weather.md) |
| Air quality | `station`, an hourly timestamp, `pm25`/`pm10`/`no2` in µg/m³ | [air-quality](domains/air-quality.md) |
| Vehicle telematics | a `vehicle`/`device` id, a trip timestamp, `distance_km`/`odometer`, `speed`, event counts (`harsh_brakes`, `idle_min`); one row per trip | [vehicle-telematics](domains/vehicle-telematics.md) |
| Fleet and maintenance | a `vehicle`/`asset` id, a work order id, `job`/`type`, `cost`, `downtime_days`, a `preventive` flag | [fleet-maintenance](domains/fleet-maintenance.md) |
| Logistics | `shipment_id`, ship date, `carrier`, `region`/`lane`, `transit_days`, a promised date or `on_time` flag | [logistics](domains/logistics.md) |
| Support tickets | `ticket_id`, opened date, `status`, `priority`, `channel`, `first_response_min`, `csat` | [support-tickets](domains/support-tickets.md) |
| IT operations / logs | an event `ts`, `service`/`host`, `level` ERROR/WARN/INFO, `latency_ms`; one row per log event | [it-operations-logs](domains/it-operations-logs.md) |
| Issue tracking | `issue_id`/`key`, opened date, `type` bug/feature/task, `status`, `points`/`estimate` | [issue-tracking](domains/issue-tracking.md) |
| HR | `employee_id`, `department`, `hire_date`, `salary`, `tenure`, a `left` flag or termination date | [hr](domains/hr.md) |
| Sports / tournament results | `team`, a game date, `goals_for`/`goals_against` or two scores, `result`/`points` | [sports-tournament-results](domains/sports-tournament-results.md) |
