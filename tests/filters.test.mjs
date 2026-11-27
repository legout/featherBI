import assert from "node:assert/strict";
import test from "node:test";
import { defaultRange, expand, latestWins, parseHash, serializeHash } from "../skill/featherbi/scripts/lib/filters.mjs";

// Expected SQL and params are hand-written from spec 0001 §Filters.
const dims = { region: { col: "region", cols: { targets: "region_code" } }, channel: { col: "channel" } };
const date = { col: "order_date", cols: { targets: "month" } };
const tableColumns = { sales: ["order_date", "region", "channel", "revenue"], targets: ["region_code", "month", "target"], notes: ["id", "text"] };
const none = { dims: {}, from: null, to: null };
const run = (sql, state, exclude) => expand(sql, state, dims, date, tableColumns, exclude);

test("no active filter expands to TRUE", () => {
  assert.deepEqual(run("SELECT 1 FROM sales WHERE {{filters:sales}}", none), { sql: "SELECT 1 FROM sales WHERE TRUE", params: [] });
});

test("one dimension is bound as a parameter", () => {
  assert.deepEqual(run("WHERE {{filters:sales}}", { ...none, dims: { region: "EU" } }), { sql: 'WHERE "region" = $1', params: ["EU"] });
});

test("an alias qualifies the columns", () => {
  assert.deepEqual(run("FROM sales s WHERE {{filters:sales AS s}}", { ...none, dims: { channel: "Online" } }), { sql: 'FROM sales s WHERE "s"."channel" = $1', params: ["Online"] });
});

test("a table without the dimension is not filtered by it", () => {
  assert.deepEqual(run("WHERE {{filters:notes}}", { dims: { region: "EU" }, from: "2025-01-01", to: "2025-03-31" }), { sql: "WHERE TRUE", params: [] });
});

test("two tables: per-table cols, one placeholder per table, parameters in text order", () => {
  const state = { dims: { region: "EU", channel: "Online" }, from: "2025-01-01", to: "2025-03-31" };
  assert.deepEqual(run("FROM sales s JOIN targets t ON 1=1 WHERE {{filters:sales AS s}} AND {{filters:targets AS t}}", state), {
    sql:
      'FROM sales s JOIN targets t ON 1=1 WHERE "s"."region" = $1 AND "s"."channel" = $2 AND CAST("s"."order_date" AS DATE) BETWEEN CAST($3 AS DATE) AND CAST($4 AS DATE)' +
      ' AND "t"."region_code" = $5 AND CAST("t"."month" AS DATE) BETWEEN CAST($6 AS DATE) AND CAST($7 AS DATE)',
    params: ["EU", "Online", "2025-01-01", "2025-03-31", "EU", "2025-01-01", "2025-03-31"],
  });
});

test("exclude drops that dimension, and only that one", () => {
  const state = { dims: { region: "EU", channel: "Online" }, from: null, to: null };
  assert.deepEqual(run("WHERE {{filters:sales}}", state, ["region"]), { sql: 'WHERE "channel" = $1', params: ["Online"] });
});

test("an unknown table or placeholder is an error", () => {
  assert.throws(() => run("{{filters:ghost}}", none), /ghost/);
  assert.throws(() => run("{{nope}}", none), /nope/);
});

test("the date anchor is the latest date across all dated tables", () => {
  const bounds = [{ min: "2025-01-05", max: "2025-03-25" }, { min: "2024-11-01", max: "2025-06-10" }];
  // 12 calendar months ending in the month of the latest date (June 2025): July 2024 .. 2025-06-10.
  assert.deepEqual(defaultRange({ default: "last_12_months" }, bounds), { from: "2024-07-01", to: "2025-06-10" });
  assert.deepEqual(defaultRange({}, bounds), { from: "2024-07-01", to: "2025-06-10" });
  assert.deepEqual(defaultRange({ default: "all" }, bounds), { from: "2024-11-01", to: "2025-06-10" });
  assert.deepEqual(defaultRange({ default: { from: "2025-02-01", to: "2025-02-28" } }, bounds), { from: "2025-02-01", to: "2025-02-28" });
  assert.deepEqual(defaultRange({ default: "all" }, []), { from: null, to: null });
});

// Hash and sequencing: hand-written from spec 0001 r4 §Filters (URL hash, latest state wins).
const model = {
  dims,
  date,
  options: { region: ["EU", "US", "R&D x"], channel: ["Online", "Retail"] },
  range: { from: "2024-04-01", to: "2025-03-25" },
};
const state = (d = {}, from = model.range.from, to = model.range.to) => ({ dims: d, from, to });

test("hash: no active filter is the empty hash; dims follow config order; date only when not the default", () => {
  assert.equal(serializeHash(state(), model), "");
  assert.equal(serializeHash(state({ region: "EU" }), model), "#region=EU");
  assert.equal(serializeHash(state({ channel: "Online", region: "EU" }), model), "#region=EU&channel=Online");
  assert.equal(serializeHash(state({ region: "EU" }, "2025-01-01", "2025-02-28"), model), "#region=EU&date=2025-01-01..2025-02-28");
  assert.equal(serializeHash(state({}, "2025-01-01", "2025-02-28"), model), "#date=2025-01-01..2025-02-28");
  assert.equal(serializeHash(state({ region: "R&D x" }), model), "#region=R%26D%20x");
});

test("hash: a valid hash parses back to the state, URL-decoded", () => {
  assert.deepEqual(parseHash("#region=EU&channel=Online&date=2025-01-01..2025-02-28", model), state({ region: "EU", channel: "Online" }, "2025-01-01", "2025-02-28"));
  assert.deepEqual(parseHash("#region=R%26D%20x", model), state({ region: "R&D x" }));
  assert.deepEqual(parseHash("", model), state());
  assert.deepEqual(parseHash("#", model), state());
});

test("hash: every invalid part is ignored and the valid parts still apply", () => {
  assert.deepEqual(parseHash("#country=FR&region=EU", model), state({ region: "EU" })); // undeclared dimension
  assert.deepEqual(parseHash("#region=Mars&channel=Retail", model), state({ channel: "Retail" })); // unknown value
  assert.deepEqual(parseHash("#region=EU&date=2025-03-01..2025-01-01", model), state({ region: "EU" })); // from > to
  assert.deepEqual(parseHash("#date=2025-02-30..2025-03-01", model), state()); // not a calendar date
  assert.deepEqual(parseHash("#date=2025-1-1..2025-03-01", model), state()); // not ISO
  assert.deepEqual(parseHash("#date=2025-03-01..2025-03-01", model), state({}, "2025-03-01", "2025-03-01")); // from = to is allowed
  assert.deepEqual(parseHash("#region=%E0%A4%A&channel=Online&&=x&junk", model), state({ channel: "Online" })); // malformed encoding, empty parts
  assert.deepEqual(parseHash("#constructor=EU&__proto__=EU&date=EU", model), state()); // names that exist on every object are not dimensions
});

// Spec 0005 §5: with `layout: tabs` the model carries the number of tabs; the open tab is `tab=<n>` (1-based) when it is not the first.
const tabbed = { ...model, tabs: 2 };

test("hash: the open tab follows the filters as `tab=<n>`, only when it is not the first", () => {
  assert.equal(serializeHash({ ...state({ region: "EU" }), tab: 2 }, tabbed), "#region=EU&tab=2");
  assert.equal(serializeHash({ ...state({ region: "EU" }, "2025-01-01", "2025-02-28"), tab: 2 }, tabbed), "#region=EU&date=2025-01-01..2025-02-28&tab=2");
  assert.equal(serializeHash({ ...state(), tab: 2 }, tabbed), "#tab=2");
  assert.equal(serializeHash({ ...state({ region: "EU" }), tab: 1 }, tabbed), "#region=EU");
  assert.equal(serializeHash({ ...state(), tab: 1 }, tabbed), "");
  assert.deepEqual(parseHash("#region=EU&tab=2", tabbed), { ...state({ region: "EU" }), tab: 2 }); // round trip
  assert.deepEqual(parseHash("#tab=2", tabbed), { ...state(), tab: 2 });
});

test("hash: an invalid or out-of-range tab is ignored and the valid parts still apply", () => {
  for (const tab of ["0", "9", "3", "x", "-1", "1.5", "2x", "2e0", "", " 2", "9".repeat(400)]) {
    assert.deepEqual(parseHash(`#region=EU&tab=${encodeURIComponent(tab)}`, tabbed), state({ region: "EU" }), `tab=${tab.slice(0, 5)}`);
  }
  assert.deepEqual(parseHash("#tab=2&tab=9", tabbed), { ...state(), tab: 2 });
  assert.deepEqual(parseHash("#region=EU&tab=2", model), state({ region: "EU" })); // no tabs on the page: nothing to open
});

test("sequence: a result for an older number is never painted, and the newest state is the one painted", async () => {
  const gates = [];
  const painted = [];
  const runner = latestWins(async current => {
    const n = gates.length;
    await new Promise(resolve => gates.push(resolve));
    if (current()) painted.push(n);
  });
  runner.change(); // run 0 starts
  const done = runner.change(); // arrives while run 0 is in flight
  runner.change(); // so does this one
  gates[0](); // run 0 finishes after two newer changes: stale, dropped
  await new Promise(r => setImmediate(r));
  assert.equal(gates.length, 2, "the two intermediate changes coalesce into one next run");
  gates[1]();
  await done;
  assert.deepEqual(painted, [1]);
});

test("sequence: a change after the run finished starts a fresh run", async () => {
  let runs = 0;
  const runner = latestWins(async () => void runs++);
  await runner.change();
  await runner.change();
  assert.equal(runs, 2);
});

test("sequence: a failing run does not stop later changes", async () => {
  let runs = 0;
  const runner = latestWins(async () => {
    if (++runs === 1) throw new Error("boom");
  });
  await runner.change().catch(() => {});
  await runner.change();
  assert.equal(runs, 2);
});
