# Export filters Implementation Plan

**Goal:** Add a reusable export filter with focused tests.

## Global Constraints

- Preserve the public function signature.
- Do not add dependencies.

### Task 1: Filter predicate

**Files:** `src/export/filter.py`, `tests/test_filter.py`

**Acceptance:** Empty filters preserve current behavior; matching filters exclude rows.

### Task 2: API wiring

**Files:** `src/export/api.py`, `tests/test_api.py`

**Depends on:** Task 1

**Acceptance:** API passes the parsed filter to the predicate and tests cover the request path.
