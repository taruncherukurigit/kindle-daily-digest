# Design tradeoffs: why no AI

## The version that came before this one

The first working version of this pipeline used Claude Code in headless mode, authenticated against an existing Claude Pro subscription (not the paid API), to do three things per run. Search the web for topics not covered by RSS. Summarize and organize fetched articles. Write a short recommendations section.

It worked. Content was genuinely synthesized and curated, not just aggregated. But it broke in production on real usage. A run design with roughly 28 total AI calls, including uncapped live web search, could exhaust the Pro plan's rolling 5 hour session window on its own, especially when the session already had prior usage that day. When that happened, the digest simply didn't send. No content, no visible error until checked manually.

A tighter version (2 calls per run, capped synthesis length, search reserved for a handful of gap topics, scheduled to start on a fresh session at 4:30am) reduced that risk a lot, but didn't remove it, and added real complexity: session window math, per-call system prompt overhead, resumability logic in case a run died partway through.

## The decision

Rather than keep tuning around a usage limit ceiling, the pipeline was rebuilt with zero AI calls anywhere in the run path. Curation moved from a model deciding what matters to a set of fixed rules: source authority weighting, per-feed volume caps, cross-category deduplication, and freshness sorting.

## What was gained

- **Reliability that doesn't depend on session accounting.** There's no scenario where this pipeline fails because of a usage cap, because it makes zero calls to any LLM.
- **Zero marginal cost**, same as before, but without the fragility of staying under a moving cost ceiling.
- **Full transparency.** Every article in a digest traces back to a specific feed and a specific rule (primary source weighting, freshness, per-feed cap), not an opaque model decision.

## What was given up

- **No editorial judgment.** The old version could recognize that a given day's most important story deserved more space, or skip something low-value even from a primary source. This version can't make that call. It shows what's unread, ranked only by source authority and recency.
- **No coverage beyond the configured feeds.** The old version's live web search could surface a genuinely important story that wasn't on any subscribed feed yet. This version is strictly bounded by whatever sources per category happen to publish.
- **No synthesis across sources.** If three feeds cover the same event with different framing, this version shows three separate full articles instead of one synthesized view. Deduplication only catches near-identical titles, not the same story told differently.

## When AI curation would actually be worth revisiting

Not as a default addition, but specifically if a category consistently produces more genuinely distinct, substantial articles per run than can reasonably be read. Rough threshold: 15 to 20 plus per category, regularly. At that point ranking help solves a real problem instead of adding risk for a marginal gain. Actual per-category volume per run has stayed far below that threshold so far, so this hasn't been necessary.

## Why images were removed entirely

An early iteration tried to embed article images. First from the RSS enclosure field, then with a fallback that pulled the first `<img>` tag out of the raw article HTML before stripping tags. Coverage stayed inconsistent. Plenty of feeds don't populate enclosure at all, and the receiver's `/extract` endpoint (built on `trafilatura.extract()` with default output) returns plain text only, so full-text-extracted articles never had an image to fall back on regardless.

The choice was between building a more involved image pipeline (a dedicated image scraping step, or switching extraction to a format that preserves `<img>` nodes and downloading each image into the epub manifest) and just not doing images. A digest is read for the text, not the pictures. The added complexity and per-run download overhead wasn't worth it. Images were dropped rather than left half-working.

## Why Quick Skim links jump within the epub, not out to the web

The original Quick Skim index was plain text with no links at all. The first fix added external links straight to each article's source URL. That's useful, but the more natural behavior for something still primarily read as an ebook is for the index to jump to the full article text already embedded in the same file. No network dependency, works the same on an e-ink Kindle with no browser as it does in the Kindle app on a phone.

Each article title is now a real markdown heading with an explicit anchor id (`### Title {#category-1}`), which pandoc turns into a jumpable in-document link. The Quick Skim entry for that article links to the anchor as the primary action, with a small secondary source link next to it for anyone who wants to leave the epub and read the original page online.
