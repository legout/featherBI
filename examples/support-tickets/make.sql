-- Generates tickets.parquet next to this file. Run here: duckdb < make.sql
-- Deterministic: every value is a pure function of the row number i (no clock, no random, no network).
-- 800 tickets (i = 0 ... 799):
--   ticket_id = i + 1; opened = 2025-03-01 + (i mod 30) days
--   channel by i mod 3: Email, Chat, Phone; priority by i mod 4: Low, Medium, High, Urgent
--   status = 'Open' when i mod 10 = 0, else 'Resolved'; first_response_min = 10 + 5 * (i mod 8); csat = 1 + i mod 5
COPY (
  SELECT i + 1 AS ticket_id,
         DATE '2025-03-01' + (i % 30)::INTEGER AS opened,
         ['Email', 'Chat', 'Phone'][i % 3 + 1] AS channel,
         ['Low', 'Medium', 'High', 'Urgent'][i % 4 + 1] AS priority,
         CASE WHEN i % 10 = 0 THEN 'Open' ELSE 'Resolved' END AS status,
         10 + 5 * (i % 8) AS first_response_min,
         1 + i % 5 AS csat
  FROM range(800) t(i) ORDER BY i
) TO 'tickets.parquet' (FORMAT parquet);
