# UI prototype

> Adapted from [`mattpocock/skills`](https://github.com/mattpocock/skills/tree/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/prototype/UI.md) at commit `3cca18b368ae95cdbdebbff572ccafa662551015` (MIT).

A prototype answers an observable visual question; it is not a production implementation route. State the question and variant count first. Default to three structurally different variants and cap at five, but use one probe when there is only one reasonable uncertainty or no genuine alternatives. Do not manufacture variants to satisfy the default.

1. Keep real read-only data flow where safe; stub mutations.
2. Make variants disagree about layout, hierarchy, or primary affordance—not merely color or copy.
3. Select variants through a shareable URL parameter such as `?variant=A`.
4. Add a fixed, obviously temporary switcher with previous/next controls and arrow-key support that ignores focused text inputs.
5. Gate the switcher from production builds.
6. Give the user exact URLs and ask what to keep from each variant.

A user's selection is a prototype verdict, not authorization to implement production code. Preserve the question, selected variant, evidence, confidence, and rationale; clean up only the bounded experiment. Return the verdict to `shape-design`, which owns reclassification, approval, and the normal implementation handoff. Do not silently promote prototype files, switchers, or a selected variant into production.
