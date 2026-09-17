# doc/

Topic documentation for zhakram (the zena-on-jco guest project; repo and
fork checkout keep the `zena-jco` name). Inquiry and drafts live in subdirectories
and get promoted here deliberately.

## research/ — start here

[`research/`](research/) holds the research corpus and the plan of record:

1. [`research/getting-started.glm53max.md`](research/getting-started.glm53max.md) — kickoff: validated facts, experiment ladder, the known blocker
2. [`research/work-outline.glm53max.md`](research/work-outline.glm53max.md) — plan of record: posture (p2-direct), repo layout, workstreams, sequencing

## jspi/ — design waves

What JSPI means to zena's async — two independent design waves plus a
synthesis, written as an upstreamable assessment for the zena fork:

1. [`jspi/design0.glm53max.md`](jspi/design0.glm53max.md) — design0: zena's
   Track G generators/CPS mapped onto runtime-integration drivers, with
   JSPI-first as the hypothesis
2. [`jspi/design1.solmax.md`](jspi/design1.solmax.md) — design1: zena
   async/await over a retained-stack JSPI driver first, a WASI Preview 3
   callback driver second
3. [`jspi/syn1.glm53h.md`](jspi/syn1.glm53h.md) — syn1: cross-review and
   re-integration of design0/design1 into one upstreamable position

## zena/

- [`zena/issues.md`](zena/issues.md) — living ledger of zena compiler
  defects found by exercising zena through the jco pipeline: symptom,
  root cause, repro, fix, verification, and status for each

## Conventions

- Research/wave files are model-suffixed markdown
  (`<topic>.<model>.md`, e.g. `getting-started.glm53max.md`) — the suffix
  names the model that wrote them.
- Documents carry OKF frontmatter (`type`, `title`, `description`,
  `generated`, `stale_after`, …) as a trustworthiness label.
- Work is committed in stages as it lands; commit messages state what was
  verified and how (or flag `staged unverified: …` honestly).
