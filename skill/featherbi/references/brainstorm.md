# Brainstorming mode

Read this when the user gives data but not what to show, or asks for ideas. Skip the mode when the request is specific ("revenue by month as a bar chart"): build directly, no interview.

## Flow

1. **Profile** every source (`node scripts/featherbi.mjs profile ...`). The output has per-column `nulls`, `distinct`, `min`/`max`, `top` and `step`; `sampled: true` means the profile used a sample (`count` stays exact).
2. **Recognise the domain.** Read `references/domains.md`, compare its detection signals with column names, types, value patterns and grain, then read only the matching playbook. State the guess and its evidence in one or two lines. Unclear or mixed: say so and ask. No match: continue without a playbook.
3. **Interview**, one round, see below.
4. **Propose** three ideas, see below. Stop and wait for the pick; never build before the user picks or edits an idea.
5. **Build** the picked idea following the normal workflow in `SKILL.md`, and report as usual.

## Question rules

- At most 5 questions in one round, chosen from the playbook's interview questions and adapted to the data: audience, the decision the dashboard supports, time grain, breakdowns, what counts as good or bad (targets, limits).
- Give a sensible default for every question, so "go with the defaults" is a valid answer.
- Never ask what the profile already answers.
- Use the host's structured question tool when there is one, otherwise plain text.

## Proposal format

Exactly 3 ideas. Each has:

- a title and its audience;
- 4–8 tiles; each tile names the question it answers, its tile type or preset (`references/presets.md`) and the columns it uses;
- a list of assumptions (a unit, a limit, a currency, a time zone).

Every column named must exist in the profile. Anything not in the data is an assumption, marked as one.

## Never invent data

Do not invent columns, values, targets, limits or figures. A figure is a SQL aggregate over the snapshot. If the data lacks something an idea needs, say so, mark it an assumption or drop the tile.
