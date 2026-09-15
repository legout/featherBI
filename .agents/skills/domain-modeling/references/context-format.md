# CONTEXT.md Format

> Adapted from [`mattpocock/skills`](https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/domain-modeling/CONTEXT-FORMAT.md) at commit `3cca18b368ae95cdbdebbff572ccafa662551015` (MIT). Local changes align structure resolution with configured context ownership in `domain-modeling/SKILL.md`.

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.

## Single vs multi-context repos

**Single context (most repos):** One `CONTEXT.md` at the repo root.

**Multiple contexts:** A `CONTEXT-MAP.md` at the repo root lists the contexts, where they live, and how they relate to each other:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md): receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md): generates invoices and processes payments
- [Fulfillment](./src/fulfillment/CONTEXT.md): manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

Resolve the structure from configuration and evidence together, exactly as the skill's discovery rules do:

- Read `docs/agents/domain.md` when present; its explicit single/multiple-context declaration is configuration, not a suggestion to invent names.
- If `CONTEXT-MAP.md` exists, read it and follow its real paths; never write around a map or invent a fictional one.
- If configuration or evidence resolves to a single context — including a configured single-context repo that has no glossary yet — use the root `CONTEXT.md`, creating it lazily only when the first term is actually resolved.
- If configuration declares multiple contexts but no map or resolvable owner exists, stop and ask which real context owns the term; do not create a root `CONTEXT.md` just because the map is absent.
- If explicit configuration and existing map/glossary evidence conflict, surface the conflict to the owner instead of silently rewriting either source.

When multiple contexts exist, infer which one the current topic relates to. If unclear, ask.
