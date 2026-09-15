# Logic prototype

> Adapted from [`mattpocock/skills`](https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/prototype/LOGIC.md) at commit `3cca18b368ae95cdbdebbff572ccafa662551015` (MIT).

Use a single self-contained HTML file when the question concerns business rules, state transitions, data shape, or an API model.

1. Display the exact question at the top.
2. Put the relevant behavior in one pure reducer, state machine, function set, or small stateful module with no DOM dependency.
3. Render the full state in domain language after every action.
4. Provide free-play actions plus guided scenarios for the happy path, difficult edge case, and an illegal action.
5. Reset each scenario to a known state.
6. Keep HTML, CSS, and JavaScript inline so a non-developer can open the file directly.

The page is disposable. Only a validated logic shape may be reimplemented in production after normal design and test gates. Do not add a framework, database, generalization, or production error handling.
