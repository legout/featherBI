# Support tickets

Playbook for brainstorming mode. Example: `examples/support-tickets/`.

## Detection signals

A `ticket_id`, an opened date, `status` open/resolved, `priority`, `channel`, `first_response_min` or response and resolution timestamps, maybe `csat`. Grain: one row per ticket.

## Interview questions

- Who is it for: support lead, agent or management? Default: support lead.
- Which status counts as open? Default: everything not resolved or closed.
- Response time in calendar or business hours? Default: calendar; say so.
- Break down by priority, channel or agent? Default: priority.
- Is an SLA target given? Default: none; never invent one.

## Figures

```sql
SELECT COUNT(*) AS tickets FROM tickets;
SELECT COUNT(*) AS open_tickets FROM tickets WHERE status = 'Open';
SELECT AVG(first_response_min) AS average_first_response_min FROM tickets;
SELECT AVG(csat) AS average_csat FROM tickets;
SELECT priority, COUNT(*) AS tickets FROM tickets GROUP BY 1 ORDER BY 1;
```

## Tile ideas

- KPIs: tickets, open tickets, first response, CSAT. Are we keeping up?
- `line` of tickets opened per day. When does demand peak?
- `bar` of tickets by priority. How urgent is the load?
- `donut` of tickets by channel. Where do customers reach us?

## Traps

- Open tickets is a state at a point in time; a snapshot taken later changes it.
- CSAT is only answered by some customers; average the responses, not the tickets, and say how many.
- Reopened tickets: count a ticket once, by id.
- Response time of unanswered tickets is missing, not zero.
- Average of per-agent averages is not the team average; divide sums.
