import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { Seed } from './seeds.js';

// Prompt building. Everything here encodes lessons paid for in production:
//
//  * Without a reality anchor, every operator escalates a seed into
//    hyperscale fiction (clusters, fleets, teams) that the operator of a
//    small setup can never test. The anchor pins ideas to a testable scale.
//  * Without fact discipline, models confidently invent mechanisms behind a
//    seed's name ("the cache is SQLite") and the whole downstream pipeline
//    reasons about fiction. Seeds may carry verified facts; the prompt
//    forbids contradicting them.
//  * Long nested prompts make small models emit empty or fence-mangled
//    JSON. Prompts stay compact, with a strict one-object JSON contract.
//
// The anchors are the personalization surface of Loomwerk: users should
// replace the defaults with their own scale, skills and constraints.

export const SETUP_ANCHOR =
  process.env.LOOMWERK_ANCHOR_SETUP ??
  'REALITY ANCHOR: This is a small, self-hosted setup run by ONE person on ' +
    'the side — a single server or workstation, a handful of services, scripts ' +
    'and scheduled jobs. There is NO cluster, NO team, NO fleet of devices, no ' +
    'hyperscale infrastructure. A good hypothesis is implementable on exactly ' +
    'this scale within hours and testable with on-board tools. Reject any ' +
    'escalation into big-infrastructure fantasy — stay concrete on this setup.';

export const IDEA_ANCHOR =
  process.env.LOOMWERK_ANCHOR_IDEA ??
  'REALITY ANCHOR (ideas/business): Develop a concrete idea, opportunity or ' +
    'innovation connecting the given topics. You may leave the setup itself ' +
    '(product, offer, content, method, market) — but stay FACTUAL: no invented ' +
    'market numbers, no hype, no assumptions about team, capital or resources ' +
    'that do not exist. The operator works alone and on the side. A good idea ' +
    'is testable with a small stake: ONE conversation, ONE landing page, ONE ' +
    'manual run, ONE evening prototype. Prefer ideas at the intersection of ' +
    "the operator's unfair advantages — what could ONLY someone with this " +
    'combination of skills and assets see or offer? EXTEND, DO NOT REBUILD: ' +
    'if an existing building block (listed below, if any) already covers the ' +
    'core, phrase the idea as its concrete extension, not as a rebuild.';

// The variation operators are the actual innovation lever: each forces a
// different mental move onto the tension so the output is not just a status
// report. Same keys for both modes; only the target differs.
export const OPERATORS_SETUP: Record<string, string> = {
  analogy:
    'Transfer the pattern to another domain and derive ONE concrete step ' +
    'applicable to THIS setup (the analogy is a thinking aid, not the result).',
  combination:
    'Connect this tension with a SECOND system or concept from the setup ' +
    'that normally has nothing to do with it.',
  inversion:
    'Invert the assumption: what if the apparent problem is a FEATURE, an ' +
    'early-warning signal, or an opportunity?',
  constraint:
    'Add a radical constraint (no LLM allowed / one line only / zero budget / ' +
    'must run in 5 minutes) — what emerges then?',
  scaling:
    'Scale WITHIN the real setup (one service → all services, monthly → ' +
    'daily, one project → all projects): what breaks, what suddenly becomes possible?',
};

export const OPERATORS_IDEA: Record<string, string> = {
  analogy:
    'Transfer the pattern of one topic onto the other and derive ONE concrete idea or offer.',
  combination:
    'Combine both topics into ONE new idea, product, service or piece of content that does not exist yet.',
  inversion:
    'Invert the assumption: what if the connection between these topics is an overlooked opportunity, market or advantage?',
  constraint:
    'Add a radical constraint (one weekend / zero budget / no code / on-board tools only): what is the smallest sellable version?',
  scaling:
    'Think the idea from the smallest real test (1 customer / 1 unit / 1 page) toward a repeatable offer: next step, and the bottleneck?',
};

const OP_KEYS = Object.keys(OPERATORS_SETUP).sort();

// Deterministic per seed — reproducible runs, even distribution, no RNG.
export function pickOperator(seedKey: string): string {
  let sum = 0;
  for (const ch of seedKey) sum += ch.codePointAt(0) ?? 0;
  return OP_KEYS[sum % OP_KEYS.length]!;
}

export function isIdeaMode(seed: Pick<Seed, 'mode'>): boolean {
  return seed.mode !== 'setup';
}

// Optional inventory of existing building blocks, injected into idea
// prompts. Without it, the engine happily re-proposes things that already
// exist. Users maintain this as a short markdown file.
export function loadAssets(): string {
  const file = process.env.LOOMWERK_ASSETS_FILE ?? path.join(config.dataDir, 'assets.md');
  try {
    return fs.readFileSync(file, 'utf8').trim().slice(0, 3000);
  } catch {
    return '';
  }
}

export function pulsePrompt(seed: Seed, op: string, antiTasteBlock: string): string {
  const jsonContract =
    'Answer ONLY as JSON: {"statement": "the idea in one crisp sentence", ' +
    '"rationale": "2-3 sentences: why interesting + the first cheap test"}';

  if (isIdeaMode(seed)) {
    const assets = loadAssets();
    const assetsBlock = assets
      ? `EXISTING BUILDING BLOCKS (think of ideas as extensions of these):\n${assets}\n\n`
      : '';
    return (
      'You are the variation layer of an innovation engine. From ONE observed ' +
      'tension between topics in the operator’s knowledge base you produce ' +
      'EXACTLY ONE concrete, surprising idea or opportunity — no status ' +
      'report, no summary of the notes, no chatter.\n\n' +
      `${IDEA_ANCHOR}\n\n` +
      assetsBlock +
      `OBSERVED TENSION (${seed.seedType}/${seed.domain}):\n${seed.tension}\n\n` +
      'FACT DISCIPLINE: Ground yourself in the material quoted above. Do not ' +
      'invent facts about markets, numbers or resources. The idea MUST connect ' +
      'the given topics, not merely repeat one of them.\n\n' +
      antiTasteBlock +
      `THINKING OPERATOR: ${OPERATORS_IDEA[op]}\n\n` +
      jsonContract
    );
  }
  return (
    'You are the variation layer of an innovation engine for a self-hosted ' +
    'software/infrastructure setup. From ONE observed tension you produce ' +
    'EXACTLY ONE concrete, surprising but grounded hypothesis — no status ' +
    'report, no truism, no chatter.\n\n' +
    `${SETUP_ANCHOR}\n\n` +
    `OBSERVED TENSION (${seed.seedType}/${seed.domain}):\n${seed.tension}\n\n` +
    'FACT DISCIPLINE: Stick strictly to the FACTS given above. Do NOT invent ' +
    'any mechanism or architecture not stated there (no specific tables, ' +
    'connection pools, process checks, couplings). If a "NOT:" clause is ' +
    'present, do not contradict it. If the mechanism is unknown, phrase the ' +
    'hypothesis as an investigation ("Check whether …"), not as a claim.\n\n' +
    antiTasteBlock +
    `THINKING OPERATOR: ${OPERATORS_SETUP[op]}\n\n` +
    jsonContract
  );
}

export function prescreenPrompt(statement: string, rationale: string | null): string {
  return (
    'You are a strict pre-filter. Is the following text a REAL, testable ' +
    'innovation hypothesis — and NOT a mere observation, a status note, ' +
    'empty, or nonsense?\n\n' +
    `HYPOTHESIS: ${statement}\n` +
    `RATIONALE: ${rationale ?? '(none)'}\n\n` +
    'Answer with EXACTLY one word: YES or NO.'
  );
}

export function factcheckPrompt(facts: string, statement: string, rationale: string | null): string {
  // Precision over recall — this gate KILLS ideas, so a contradiction only
  // counts if the model can quote the violated clause verbatim.
  return (
    'You check whether a HYPOTHESIS directly contradicts a VERIFIED FACT. A ' +
    'contradiction exists ONLY if the hypothesis ASSERTS a mechanism or ' +
    'architecture that a "NOT:" clause excludes, or openly contradicts a ' +
    'stated fact. A hypothesis that picks up, reinterprets or reframes a fact ' +
    'as an opportunity is NOT a contradiction. When in doubt: no contradiction.\n\n' +
    `FACTS: ${facts}\n\n` +
    `HYPOTHESIS: ${statement}\n` +
    `RATIONALE: ${rationale ?? '(none)'}\n\n` +
    'Answer ONLY as JSON: {"violated_clause": "verbatim quote from FACTS that ' +
    'the hypothesis contradicts — or empty string if none", "contradiction": true/false}'
  );
}

export function judgePrompt(
  seedMode: 'setup' | 'idea',
  statement: string,
  rationale: string | null,
): string {
  const lens =
    seedMode === 'idea'
      ? 'IMPORTANT: feasibility = testable in the real world with a small ' +
        'stake (1 conversation / 1 landing page / 1 manual run / 1 evening ' +
        'prototype), NOT "runs on the server". value = real benefit if the ' +
        'idea holds. Punish invented market numbers or hype with low value/feasibility.\n'
      : 'IMPORTANT: measure feasibility AND value against the reality anchor. ' +
        'Hypotheses assuming big infrastructure (clusters, device fleets, a ' +
        'team) are not implementable on this setup → feasibility near 0.\n';
  const anchor = seedMode === 'idea' ? IDEA_ANCHOR : SETUP_ANCHOR;
  return (
    'Critical innovation panel. Judge the hypothesis strictly (most ideas are ' +
    'mediocre), each 0.0-1.0: novelty (new vs. obvious), value (benefit if ' +
    'true), feasibility (first cheap test doable), surprise (unexpected).\n' +
    `${anchor}\n` +
    lens +
    `HYPOTHESIS: ${statement}\n` +
    `RATIONALE: ${rationale ?? '(none)'}\n` +
    'Answer ONLY as JSON: ' +
    '{"novelty":0.0,"value":0.0,"feasibility":0.0,"surprise":0.0,"rationale":"1 sentence"}'
  );
}

export function deepenPrompt(
  mode: 'setup' | 'idea',
  threadTitle: string,
  steps: string[],
): string {
  const listed = steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n') || '  (none yet)';
  const jsonContract =
    'Answer ONLY as JSON: {"statement":"the next step in one sentence",' +
    '"rationale":"why this advances the line + first test (1-2 sentences)",' +
    '"summary":"updated one-sentence essence of the thread"}';
  if (mode === 'idea') {
    return (
      'You deepen an ongoing idea line ("thread") of an innovation engine. ' +
      'Give EXACTLY ONE concrete next step toward realization or validation ' +
      '— NO repetition, no summary: specialize the idea, combine a new ' +
      'aspect, or propose the next cheap experiment or offer.\n\n' +
      `${IDEA_ANCHOR}\n` +
      'MANDATORY: The step must be testable with a small stake and stay ' +
      'factual — no hype, no invented numbers, no resource assumptions. ' +
      'If the line has nothing realistically testable left, propose a clear ' +
      'conclusion/decision instead.\n\n' +
      `THREAD: ${threadTitle}\n` +
      `STEPS SO FAR:\n${listed}\n\n` +
      jsonContract
    );
  }
  return (
    'You deepen an ongoing research line ("thread") of an innovation engine. ' +
    'Give EXACTLY ONE concrete next step — NO repetition, no summary: ' +
    'specialize, combine with a new aspect, or propose the next cheap ' +
    'experiment that advances the line.\n\n' +
    `${SETUP_ANCHOR}\n` +
    'MANDATORY: The next step must be implementable on exactly this setup ' +
    'within hours. Do NOT escalate into ever-bigger infrastructure — that ' +
    'is the typical drift of these threads. FACT DISCIPLINE: do not assert ' +
    'system facts (technologies, storage types, configurations) that are not ' +
    'literally in THREAD or STEPS SO FAR — phrase unknowns as a CHECK ' +
    'step ("first check whether X is actually Y"), not as fact.\n\n' +
    `THREAD: ${threadTitle}\n` +
    `STEPS SO FAR:\n${listed}\n\n` +
    jsonContract
  );
}
