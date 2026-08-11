# Design tradeoffs: why no AI

## The version that came before this one

The first working version of this pipeline used Claude Code in headless mode, authenticated against an existing Claude Pro subscription (not the paid API), to do three things per run: search the web for topics not covered by RSS, summarize and organize fetched articles, and write a short "recommendations" section.

It worked — content was genuinely synthesized and curated, not just aggregated. But it broke in production on real usage: a run design with roughly 28 total AI calls, including uncapped live web search, was capable of exhausting the Pro plan's rolling 5-hour session window on its own, especially when the session already had prior usage in it that day. When that happened, the digest simply didn't send — no content, no error visible until checked manually.

A tighter version (2 calls per run, capped synthesis length, search reserved for a handful of gap topics, scheduled to start on a fresh session at 4:30am) reduced that risk substantially, but didn't eliminate it, and added real complexity: session-window math, per-call system-prompt overhead, and resumability logic in case a run died partway through.

## The decision

Rather than keep tuning around a usage-limit ceiling, the pipeline was rebuilt with zero AI calls anywhere in the run path. Curation moved from "Claude decides what matters" to a set of deterministic rules: source-authority weighting, per-feed volume caps, cross-category deduplication, and freshness sorting.

## What was gained

- **Reliability that doesn't depend on session accounting.** There is no scenario where this pipeline fails because of a usage cap, because it makes zero calls to any LLM.
- **Zero marginal cost**, same as before, but without the fragility that came with staying under a moving cost ceiling.
- **Full transparency.** Every article included in a digest is traceable to a specific feed and a specific rule (primary-source weighting, freshness, per-feed cap) rather than an opaque model decision.

## What was given up

- **No editorial judgment.** The old version could recognize that a given day's most important story deserved more space, or skip something low-value even if it was from a "primary" source. This version can't make that distinction — it shows what's unread, ranked only by source authority and recency.
- **No coverage beyond the configured feeds.** The old version's live web search could surface a genuinely important story that wasn't on any subscribed feed yet. This version is strictly bounded by whatever 2-3 sources per category happen to publish.
- **No synthesis across sources.** If three feeds cover the same underlying event with different framing, this version shows three separate full articles rather than a single synthesized view (deduplication only catches near-identical titles, not the same story told differently).

## When AI curation would actually be worth revisiting

Not as a default addition, but specifically if a category consistently produces more genuinely distinct, substantial articles per run than can reasonably be read (rough threshold: 15-20+ per category, regularly) — at that point, ranking help solves a real problem rather than adding risk for a marginal gain. In testing so far, actual per-category volume per run has been far below that threshold, so this hasn't been necessary.
