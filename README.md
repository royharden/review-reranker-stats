# Fair Review Re-Ranker

A local, browser-only tool that re-ranks products from their star ratings more fairly than a raw average: empirical
Bayes shrinkage toward category priors, Wilson lower bounds, verified/recency weights, and a burst detector whose
flags only down-weight reviews (never delete them) and can be confirmed or restored by a person. Nothing leaves the
browser; there is no backend, database or network call.

## Status: construction in progress (Dirty Mode)

This repository is being built in a **Dirty Mode construction run**: source and test source are written, but
**nothing has been installed, built, run or tested yet**. There is no `package-lock.json`, no dependency has been
resolved, and no test result, benchmark or evaluation number exists. The only check applied so far is a syntax-only
pass (TypeScript types stripped by Node's built-in stripper, then `node --check`) over the `.ts` files; `.tsx` files
have only been read by eye.

The code and documentation are **written by coding agents** (Claude Code and Codex subagents working from the plan in the
parent folder). Every claim about behaviour is a design intention until the deferred checks in
[`docs/DEFERRED-VALIDATION.md`](docs/DEFERRED-VALIDATION.md) have been run.

## What exists so far (milestone M1)

- Project scaffold: `package.json` (exact pinned versions, unverified), TypeScript, Vite, Vitest and ESLint config.
- `src/core/types.ts`: shared data contracts (reviews, datasets, ranking results, explanation parts, config).
- `src/core/stats/`: normal quantile/CDF, Wilson interval, mulberry32 PRNG, FNV-1a and SHA-256 hashing, paired
  bootstrap, weighted summaries, robust median/MAD scale.
- `src/core/ratingstats/`: Spearman (midranks), NDCG@k, rank percentiles.
- `tests/stats/`, `tests/ratingstats/`: Vitest test source with hand-derived expected values (not yet run).
- `config.default.json`, `config.eval.json`: parameter proposals, not yet tuned or frozen.

## What exists so far (milestone M2)

- `src/core/config.ts`: `validateConfig` checks and narrows `config.default.json` (no casts) and returns every
  error; `configHash` tags worker responses.
- `src/core/data/`: CSV schema, field validation (timestamps must be ISO with a zone or epoch milliseconds;
  zone-less ISO and epoch seconds are rejected), papaparse ingest with a byte pre-check and a 200,000-row cap that
  rejects the whole file, bounded rejected-row examples, `insufficient` labels, a canonical `Dataset` and a SHA-256
  `datasetHash`.
- `src/core/synth/`: seeded `demo`/`eval` catalogue generator with a separate truth object, code-built named traps
  (`tiny_perfect`, `category_gap`, burst traps, `quality_drift`, ...) with exported expected outcomes, and the sample
  assembly that sends everything through the real CSV parser.
- `fixtures/parsing-traps.csv` (42 hand-written rows covering every parsing trap, including the injection-text row)
  and `fixtures/parsing-traps-duplicate-header.csv`.
- `src/core/rankers/`: the `Ranker` interface, the `mean` baseline (it claims no interval) and a registry.
- `src/worker/`: typed message protocol, the worker logic (`handler.ts`), the module worker entry and a client whose
  Cancel terminates and respawns the worker; `src/ui/state.ts` discards stale responses.
- `src/ui/`: Load page (upload, `asOf` field, Load sample, validation report) and a bare Ranking table.
- Test source under `tests/data`, `tests/synth`, `tests/worker`, `tests/rankers`, `tests/ui` and
  `tests/config.test.ts` (written, not run).

## Validating later

M3 source now includes all six ranking methods, three weight ablations, posterior-mean/lower-endpoint EB keys,
positive review weights, and the sparse three-pass burst detector with seeded permutation tests and per-item Holm
correction. The worker computes and returns every method plus detector results. New test source covers the named traps, floors, overlap handling, caps,
determinism and no exclusion. None of these tests or computations has been run.

Ranking uses absolute star estimates (or Wilson's lower endpoint on the top-box-share axis). Within-category
percentiles are display-only, so category filtering does not redefine global rank. Detector p-values are evidence
scores, not fraud probabilities; volume alone never downweights a review, and untested spans remain marked partial.

M4 source adds the complete local analysis journey: Load, Ranking, Item, Bursts and Params pages; SVG timelines,
method and EB rank-key controls, category filters, per-method numbers, status labels, validation details, progress,
cancellation/reload recovery, and CSV/JSONL downloads. Item timelines use at most 160 count buckets and show a
seven-day rolling mean at each bucket end; chart aggregation never changes detector inputs. Ranking exports include
the full catalogue for the selected method, global rank/delta, interval quantity/level, ruling labels, `asOf`, hashes
and applied configuration. Text cells are formula-neutralised; numeric deltas remain numeric.

Rulings use the versioned camelCase `rulings-1` schema, retain history, and replay the highest sequence per item/span.
Only compact decisions are saved under `rulings:<datasetHash>`; reviews, text and CSV rows are never persisted.
Unreviewed/skipped flags keep the configured burst factor, confirmed flags keep it explicitly, and restored spans
use one. Overlapping active spans still apply their minimum factor once. This is a local analysis (dry run), not an
action on a catalogue. Dataset, detector-configuration (including `asOf`), and span-review hashes must match;
ranking-only changes preserve rulings. Invalidated decisions stay in the log with a reason.

Browser storage failures switch to an in-memory log and a download warning. An unreadable stored log is preserved
without overwriting it; new rulings then stay in memory. JSONL imports validate the whole log atomically. Identical
sequence/record pairs deduplicate, but conflicting sequences are rejected rather than rewriting history. Portable
logs are capped at 5 MB and 20,000 records; exceeding a cap fails visibly. Keep a JSONL download before reloading
when storage is unavailable. Configuration is not persisted: reproduce any detector edits before replaying a saved
decision. The full worker configuration hash tracks result provenance, never ruling invalidation.

Intended demo after live validation: **Load sample → Ranking → choose a method/item → Bursts → restore or confirm →
recompute → download rulings → reload the sample → replay → download ranking CSV**. Uploads use today's UTC date
as an editable `asOf`; the sample retains its fixed reference date. Params edits validate before applying. Input
limits and insufficient-support labels apply on the next load, with committed byte/row/example caps retained.
Cancel terminates and respawns the worker; **Reload last source** restores the in-memory file/sample explicitly.

The M4 test source under `tests/rulings`, `tests/explain`, `tests/export` and `tests/worker` covers replay,
invalidation, calendar-safe imports, storage fallback, grounded explanations, CSV injection cases, compact timeline
aggregation and the integrated ruling/worker protocol. These tests, all UI rendering, and all interaction behavior
are still **unrun**. `.ts` syntax checks do not establish type correctness, accessibility or runtime readiness.

Once installs are authorised, from this folder:

```sh
npm install          # resolves the pinned versions and creates package-lock.json
npm run typecheck    # app (DOM), worker (WebWorker) and Node configs
npm run lint
npm test
npm run build
```

The full list, with what each check covers, is in `docs/DEFERRED-VALIDATION.md`.

## Licence

MIT (see `LICENSE`), committed provisionally; the owner confirms the licence before any public release.
