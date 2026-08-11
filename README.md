<div align="center">

# Kindle Daily Digest Pipeline

**A fully automated, self-hosted content pipeline that curates knowledge from RSS sources, renders it as an EPUB, and delivers it to a Kindle — twice a day, at zero marginal cost, with zero dependency on AI usage limits.**

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Cost](https://img.shields.io/badge/monthly%20cost-%240-blue)
![Stack](https://img.shields.io/badge/stack-n8n%20%7C%20FreshRSS%20%7C%20Flask%20%7C%20pandoc-informational)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

---

## Overview

Every morning and evening, this pipeline logs into a self-hosted RSS reader, pulls fresh articles across 16 curated knowledge categories, ranks and deduplicates them with deterministic rules, extracts full article text, renders everything into a single EPUB, and emails it directly to a Kindle Paperwhite — with no manual step anywhere in the loop.

It runs across two LXC containers on a home Proxmox VE server, orchestrated by n8n and a lightweight Flask receiver, and costs nothing to operate on an ongoing basis.

<p align="center">
  <img src="assets/quick-skim.png" width="600" alt="Auto-generated Quick Skim headline index at the top of a digest">
  <br>
  <sub>The auto-generated "Quick Skim" index at the top of every digest — every headline, every category, one screen</sub>
</p>

## Table of contents

- [Why this exists](#why-this-exists)
- [Architecture](#architecture)
- [How it works](#how-it-works)
- [Design decisions](#design-decisions)
- [Reliability](#reliability)
- [What this deliberately doesn't do](#what-this-deliberately-doesnt-do)
- [Stack](#stack)
- [Setup](#setup)

## Why this exists

An earlier version of this pipeline used Claude Code, running against an existing Pro subscription, to search the web, summarize articles, and write curated recommendations. It worked, but it had a real reliability problem: a single run could exhaust the subscription's rolling usage window, especially with live web search layered on top of RSS fetching and synthesis. When that happened, the digest simply didn't arrive, silently.

This version replaces AI synthesis entirely with deterministic, rule-based curation — source-authority weighting, per-feed volume caps, cross-category deduplication, and freshness sorting. The tradeoff is explicit and intentional: less editorial judgment, in exchange for a system that cannot break from a usage cap, because it makes zero calls to any LLM. The full reasoning behind that decision is in [`docs/tradeoffs.md`](docs/tradeoffs.md).

## Architecture

Two containers, talking over the local network:

```
┌────────────────────────────┐              ┌─────────────────────────────┐
│   knowledge-feed (LXC)      │              │   kindle-digest (LXC)        │
│                              │              │                               │
│   FreshRSS                  │              │   Flask receiver              │
│   16 curated categories     │              │                               │
│        │                    │              │   POST /receive-digest        │
│        ▼                    │   POST       │     → pandoc → EPUB           │
│   n8n workflow               │─────────────▶│     → archive dated copy      │
│   • Schedule: 6am / 6pm      │  digest.md   │     → email to Kindle         │
│   • Fetch + rank + dedupe    │              │                               │
│   • Assemble digest.md       │◀─────────────│   POST /extract                │
│                              │   full text  │     → trafilatura              │
└────────────────────────────┘              │                               │
                                              │   GET /weekly-archive          │
                                              │     → 7-day rollup source      │
                                              └─────────────────────────────┘
```

## How it works

| Step | Component | What happens |
|---|---|---|
| 1 | **FreshRSS** | 16 categories (Physics, Biology, Chemistry, Earth, Astronomy, Mathematics, Computer Science, Economics, History, Psychology, Philosophy, Politics & Society, Culture, Technology, Companies/Business, Geography & Maps), 2-3 authoritative sources each |
| 2 | **n8n — Schedule Trigger** | Fires twice daily, 6:00 AM and 6:00 PM |
| 3 | **n8n — Fetch node** | Authenticates against FreshRSS's Google Reader–compatible API, pulls unread articles per category, applies a per-feed volume cap, sorts by source authority then freshness, marks fetched items as read |
| 4 | **n8n — Assembly node** | Deduplicates near-identical titles across categories, calls the receiver's `/extract` endpoint for full article text, embeds images, estimates reading time, builds a "Quick Skim" headline index, timestamps everything in EST |
| 5 | **Flask receiver** | Renders the finished markdown to EPUB via pandoc, archives a dated copy, emails it to the Kindle's Send-to-Kindle address |

<p align="center">
  <img src="assets/n8n-workflow.png" width="800" alt="The full n8n workflow canvas showing Schedule Trigger through final HTTP Request">
  <br>
  <sub>The complete n8n workflow: schedule → FreshRSS login → fetch/rank/dedupe → assemble → send to receiver</sub>
</p>

<p align="center">
  <img src="assets/freshrss-categories.png" width="700" alt="FreshRSS subscription management showing curated categories and feeds">
  <br>
  <sub>FreshRSS subscription management — 16 categories, 2-3 authoritative sources each</sub>
</p>

## Design decisions

**Why n8n calls out to a Flask receiver instead of doing everything itself**
Pandoc and the email-sending logic already existed and were proven working on the `kindle-digest` container from an earlier iteration. The n8n instance in this setup also doesn't expose an `Execute Command` node, so a small internal HTTP endpoint was the simplest reliable bridge between the two.

**Why source weighting instead of AI ranking**
A short allow-list of institutional/primary source names (NASA, Nature, BBC, Federal Reserve, and similar) is checked against each article's origin feed, and those are sorted ahead of secondary sources before a freshness sort. Deterministic, free, and fully auditable — every inclusion is traceable to a specific rule, not an opaque model decision.

**Why a per-feed cap instead of a per-category cap**
Early testing surfaced a real failure mode: one high-volume source (a chemistry news aggregator with 400+ unread items) dominated its entire category's fetch budget on its own. Capping each individual feed within a category — rather than the category as a whole — prevents any single source from crowding out the others.

**Why full-text extraction has a timeout**
The `/extract` endpoint makes a live HTTP request per article. Without a timeout, one slow or unreachable source could stall an entire run. An 8-second timeout with a silent fallback to the RSS summary keeps the pipeline resilient to any single bad source.

<p align="center">
  <img src="assets/digest-content.png" width="800" alt="Rendered digest showing full article text pulled via trafilatura">
  <br>
  <sub>Full article text via trafilatura, not just RSS teasers — each entry links back to the original source</sub>
</p>

## Reliability

- Both containers are set to `onboot=1` in Proxmox, surviving a host reboot.
- The Flask receiver runs as a `systemd` service (`Restart=always`), not a bare background process, so it survives crashes and container restarts.
- Every digest is archived with a timestamp before being sent, so nothing is lost even if the email step fails.
- Success and failure are both pushed via `ntfy` for explicit confirmation, not silent success.
- All timestamps are computed in `America/New_York` explicitly, independent of container system timezone.

## What this deliberately doesn't do

No AI synthesis, no live web search beyond the configured RSS feeds, no editorial judgment on story importance beyond source-authority weighting. Content quality is bounded by the curated feed list, not by an intelligence layer — a conscious tradeoff made after the earlier AI-driven version proved unreliable in production. Full reasoning in [`docs/tradeoffs.md`](docs/tradeoffs.md).

## Stack

`FreshRSS` · `n8n` · `Python` (`Flask`, `trafilatura`) · `pandoc` · `Proxmox VE` (LXC) · `Gmail SMTP` (Send-to-Kindle) · `ntfy` · `systemd`

## Setup

Full installation walkthrough in [`docs/setup.md`](docs/setup.md).

---

<div align="center">

Built and maintained as a homelab project on a Proxmox VE server running on a ThinkPad T14.

</div>
