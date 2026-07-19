# Loomwerk — UI design brief

The visual direction for the Loomwerk client. Written as a self-contained
brief so it can be handed to a designer (or a design tool) as-is; the
implementation in `client/` follows it.

---

Design a web app UI for "Loomwerk" — an open-source innovation engine that
breeds, selects, and matures ideas from a user's own knowledge sources
(notes, feeds, agent logs). It is NOT a chatbot and must not look like an
AI app: no chat bubbles, no sparkle icons, no purple gradients, no
glassmorphism, no mascot.

Design language: precision instrument. Think Dieter-Rams-era lab equipment
meets a modern trading terminal meets Linear. Dense but calm data grid,
strong Swiss typography (one grotesque for UI, monospace for
numbers/IDs/scores), near-black and paper-white neutral base with exactly
ONE signal color (e.g. instrument amber or signal orange) used only for
state and emphasis. Hairline rules, tabular numerals, visible system state
everywhere. Light + dark theme. The UI is bilingual (English/German
toggle) — allow for ~20% longer German labels.

Core mental model to make visible: an evolutionary pipeline

    TENSION → HYPOTHESIS → PROVOCATION → THREAD → ACTION

90% of ideas are culled on purpose; the UI should celebrate rigorous
selection (gates, verdicts, scores) rather than volume.

## Screens

1. **Inbox "Provocations"** — curated surviving ideas as scannable
   cards/rows with niche label, 4 sub-scores
   (novelty/value/feasibility/surprise) as compact instrument-style bars,
   taste indicator, grounding verdict badge (confirmed/refuted), and three
   decisive actions: Promote / Dismiss (with reason) / Love. Empty state
   included.
2. **Threads** — long-running idea threads as vertical depth chains (step
   1..5), with maturity state (active/dormant/ripe) and a "graduate to
   action" moment.
3. **Balance** — an honest self-audit dashboard: funnel of all ideas by
   category (win/nugget/refuted/duplicate/gate/culled/open), success +
   nugget rate, real LLM cost per cycle, CSV export. Instrument-panel
   aesthetic.
4. **Sources** — connected knowledge sources (markdown vault, RSS, logs,
   webhook) with per-source seed activity and a noise-filter config.
5. **Run view** — the daily pipeline run as a timeline (Pulse → Critic →
   Fitness → Weave) with per-stage counts and cost — like a build log,
   not a chat.
6. **First-run onboarding** — connect a source, set an LLM endpoint +
   budget cap, run a demo cycle.

Tone: engineering-grade honesty. Numbers over adjectives. Desktop-first,
responsive down to tablet.
