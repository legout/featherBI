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
