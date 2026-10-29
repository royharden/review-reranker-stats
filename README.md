# Fair Review Re-Ranker

A single-user local tool for ranking products from star ratings, with empirical Bayes shrinkage, Wilson bounds,
verified/recency weights and burst downweighting that a person can confirm or restore.

**Claim to be tested:** `full` is non-inferior to the dev-selected simple baseline on agreement with later ratings
(paired Spearman CI lower endpoint > −0.02), while planted-attack damage is at most half `bayes_global` damage when
baseline damage is positive. These are proposed acceptance thresholds, not achieved results. Category shrinkage
targets absolute star quality; it does not promise equal category representation or establish fraud.

## Source complete; runtime unverified

M1–M6 application, script and test source are written. **Nothing has been installed, built, run or tested** in this
Dirty Mode construction run. There is no lockfile, resolved dependency set, test result, browser receipt, benchmark,
evaluation measurement or Bolt import. `.ts` files received syntax-only Node type stripping plus `node --check`;
`.tsx` files received source inspection only. Relative imports/exports were inspected statically. These checks do
not establish type correctness, runtime behavior or deployment readiness.

This project is **written by coding agents**. See [deferred validation](docs/DEFERRED-VALIDATION.md) for activation
checks and [the Bolt handoff](BOLT-HANDOFF.md) for the future inspection/preparation prompt.

## What the source implements

- React + TypeScript + Vite SPA: Load, Ranking, Item, Bursts and Params pages, with computation in a module worker.
  Cancel terminates and respawns it; stale responses are discarded. Reload last source explicitly reloads the
  in-memory sample/file. No backend or database is required.
- CSV required headers `review_id,item_id,category,rating,timestamp`, optional `verified,text`. Duplicate/unknown
  headers reject the file. Limits are 25,000,000 bytes and 200,000 data rows, including invalid rows; exceeding a
  cap rejects the whole file. Retained rejection examples are bounded, with complete reason totals.
- Integer ratings 1–5, zoned ISO or epoch-millisecond timestamps, explicit editable `asOf`. Epoch seconds and
  zone-less ISO reject. First accepted review id/category wins. Verified is true/false/unknown; missing/blank means
  unknown. Items with fewer than three accepted reviews remain ranked with `insufficient`. Text affects no score,
  detector or explanation.
- `mean`, `bayes_global`, `wilson`, `eb_category`, `eb_global`, `full`, and `full-verified`, `full-recency`, `full-burst`
  ablations. Weighted EB uses effective sample size, pooled variance and category/global priors; categories with
  fewer than 20 fitting items fall back globally. Recency and final product weights are floored at 1e-12.
- EB ranks by absolute posterior mean by default, with a lower-endpoint alternative. Wilson ranks by the lower
  endpoint of its two-sided 90% interval on top-box share (rating ≥4); EB intervals concern mean stars. `mean` and
  `bayes_global` claim no interval. Within-category percentiles are display-only.
- Sparse 1/3/7-day volume candidates, merged spans, seeded two-sided rating-shift permutation tests and Holm per
  item. At most five selected spans/item and 5,000/dataset; omitted tests stay `partial`, thin reference/history
  stays unassessable. Volume alone never downweights. P-values are evidence scores, not fraud probabilities.
- Append-only `rulings-1` logs: unreviewed/skip retain the burst factor, confirm retains it explicitly, restore uses
  one. Reviews always retain positive weight; overlapping active spans apply the minimum once. Replay uses latest
  sequence and matching dataset/detector/span-review hashes. Ranking-only edits preserve rulings; detector changes
  including `asOf` can invalidate them with a reason.
- Only compact rulings persist in localStorage under `rulings:<datasetHash>`; review rows/text and configuration
  do not. Storage failure uses memory and a download warning; corrupt stored bytes are preserved. Atomic JSONL
  import deduplicates identical records and rejects conflicting sequences (5 MB/20,000 records). Reproduce detector
  settings after reload; use one editing tab per dataset.
- SVG timelines (at most 160 count buckets, trailing seven-day means), per-method numbers and grounded template
  explanations. Ranking CSV includes the selected method's whole catalogue, provenance/configuration, detector
  completeness and ruling status. String cells are formula-neutralised before RFC4180 quoting; numeric negative
  deltas remain numeric. Untrusted UI strings render as React text nodes.

The browser source has no telemetry, external fonts, model calls or runtime network fetches. Reviews stay in the
browser during app use; downloads are explicit. Vite loads packaged app/sample assets. The separate person-run
Amazon script is the external-download entrypoint and is never called by UI, tests or demo. No `providers` or
`callledger` stubs exist: no model/Jev provider, paid call or API credential is used.

## Intended demo after validation

1. Load sample. The worker generates a fixed-seed catalogue/traps and parses the hand-written parsing-trap fixture
   through the real CSV path. Inspect validation reasons and insufficient items.
2. Compare methods in Ranking, filter categories/change the EB key, then open an item. Trap outcomes such as
   `tiny_perfect` are test expectations until executed, not observations reported here.
3. Open Bursts; inspect counts, z, p, verified share and timelines. Restore or confirm a flagged span and inspect
   recomputed ranks. Volume-only, partial and unassessable labels remain explicit.
4. Download rulings, reload, load the identical sample and reproduce detector edits. Check replay, then download
   ranking CSV and `rulings.jsonl`. Params validates edits before recomputation.

## Activate and validate later

Work from the **inner product repository**, where this README and `package.json` live. Node must satisfy
`^20.9.0 || >=21.1.0`; actual local/Bolt runtime versions and pinned dependency compatibility remain unverified.
Verify every pin/peer as detailed in D1, then:

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Review/commit the generated `package-lock.json`; confirm clean `npm ci` before claiming reproducibility. Output is
`dist/`. Browser validation later uses `npm run dev -- --host 127.0.0.1 --port <reserved-port> --strictPort` after
agent-ports reservation. No environment variables are required; `.env.example` is comment only. None of these
commands has run here.

## Evaluation and reproducibility

The shared browser-safe evalkit uses fixed seeds, item-id hash splitting, dev-only tuning, frozen best simple
baseline/numeric Bayes prior count/EB key, elapsed-time cutoffs, paired item bootstrap, matching-truth intervals,
ablations and distinct dev/final planted attack families. Synthetic cutoffs use the declared calendar; real cutoffs
use dev-item timestamps per category. Final priors refit **all items' pre-cutoff reviews** (C7), scoring held-out
items only. Targets never fit priors, recency clocks or detector history.

```sh
npm run eval
npm run eval -- --final
```

The first command prepares sealed partitions, tunes dev and freezes `results/manifest.json` before final reads.
The second reuses that freeze without retuning. Another dev run cannot overwrite a manifest; use a distinct `--out`
for a separate development experiment. Final attempts, including failed reads, consume the gate. An intentional
later read requires `--final --reread`, is disclosed and is not a fresh unbiased holdout. Per-attempt report archives
remain beside current summaries. The script rewrites only the single README results block below. Local source
rows/results are gitignored; the seal is an evaluation API boundary, not encryption or OS access control.

Optional `npm run eval -- --out results-bench --benchmark` measures exact cloned 100k/200k catalogues, detector-plus-
one-method time and sampled whole-process Node heap; this is not browser-worker peak memory. Without the flag,
runtime stays `not yet measured`. `npm run gen:fixtures -- 33` writes sample/trap CSVs and separate truth labels
under gitignored `data/local/fixtures/`, never downloading data. All commands, including the ~2k-review smoke test,
remain **unrun**.

## Optional Amazon source: inspection required

`scripts/fetch-amazon.ts` is substantive source but **disabled until human inspection/configuration**. No category,
download URL, current redirect/CDN host, licence, redistribution right or real slice has been verified. A person
must inspect official Amazon Reviews 2023 documentation, category sizes and terms, choose the two smallest
categories supporting the planned later-rating cohort, and record them in `config.eval.json`. Planned attribution:
Hou et al. (2024), *Bridging Language and Items for Retrieval and Recommendation*; verify the official citation and
applicable terms during inspection. This is not a redistribution licence.

After authorization/live inspection, edit fixed `INSPECTED_CATEGORIES` with id/label, exact HTTPS `.jsonl.gz` URL,
ISO inspection time, official reference, terms reference and permitted-use basis. `EXACT_HTTPS_HOSTS` currently
contains only `huggingface.co`; add only individually inspected official redirect hosts. Unknown hosts/redirects,
alternate protocols, credentials and nonstandard ports refuse. There is no generic URL input. A person may then run
(replace `inspected-id` with the configured id):

```sh
npx --no-install tsx scripts/fetch-amazon.ts --category inspected-id --confirm-source-inspected
```

Bounds: 100,000,000 compressed bytes, 250,000,000 decompressed bytes, 200,000 source/output rows, 25,000,000 output
bytes, 1,000,000 bytes/line, 120 seconds and three redirects. Streaming gunzip buffers bounded records, never the
full download. Output retains only `review_id,item_id,category,rating,timestamp,verified`; `user_id,title,text,images`
are dropped. Local review ids are the first 32 hex characters of
SHA-256(`parent_asin|normalized-epoch-ms|1-based-nonblank-source-ordinal`), never derived from user ids.
It writes exclusively under gitignored `data/local/amazon/`, refuses existing output names and records caps,
errors/rejects/range in `<id>.csv.source.json`. Partial files remain incomplete. Even EOF leaves coverage **unverified**;
min/max timestamps alone do not establish complete representative time coverage.

For any normalized local CSV, claim-bearing evaluation requires adjacent `<file>.csv.source.json`. Inspect ordering,
filtering, temporal coverage and rights first. Only complete EOF with zero source rejects and no cap/error can be
confirmed. Preserve SHA-256/normalized row count and record the actual human check in `coverage`: status
`confirmed-complete`, zoned `checkedAt`, nonempty `checkedBy` and `basis`. Do not relabel truncated data as complete.
Missing/mismatched/truncated/unverified metadata refuses evaluation before sealing/tuning; the CSV remains available
for descriptive UI inspection. A separately prepared CSV needs this minimal honest shape (replace placeholders
with measured facts and a real inspection; the example is not an attestation):

```json
{
  "schema": "local-source-1",
  "sourceId": "your-inspected-source",
  "csvSha256": "REPLACE_WITH_64_LOWERCASE_HEX_SHA256",
  "normalizedRows": 0,
  "rejectedRows": 0,
  "complete": true,
  "truncated": false,
  "stopReason": "eof",
  "coverage": {
    "status": "confirmed-complete",
    "checkedAt": "REPLACE_WITH_ACTUAL_ZONED_ISO_TIME",
    "checkedBy": "REPLACE_WITH_INSPECTOR",
    "basis": "REPLACE_WITH_ORDERING_FILTERING_AND_FULL_COVERAGE_EVIDENCE"
  }
}
```

After inspection, replace the example path/time with the actual file and reference time:

```sh
npm run eval -- --csv data/local/amazon/inspected-id.csv --as-of 2025-01-01T00:00:00Z --out results-real
npm run eval -- --final --out results-real
```

CSV parsing must also report zero rejected rows. The sidecar digest, CSV hash/count and attestation are frozen into manifest
provenance before tuning; final admission requires that readiness. Reports disclose person confirmation, not
independent verification. Full coverage does not bypass support gates. Real interval comparisons are predictive
agreement, never generative calibration. All commands remain unrun.

## Limits

No real-world fraud accuracy, fairness, causal quality or production readiness is established. Category evidence
is synthetic-only; recall concerns sampled generator shapes only. Drip attacks can evade volume screening;
two-sided shifts/per-item correction do not control catalogue-wide false flags. New/thin items and capped spans
can be unassessable or partial. Priors/weighting can move organic ranks. See [LIMITATIONS](docs/LIMITATIONS.md)
for the four required failure reports, C7/C15 choices, storage/interval caveats and not-yet-measured outcomes.

<!-- results:start -->

**not yet measured** — checks (a)–(e), temporal agreement, attack damage, detector precision/recall, organic downweight,
interval coverage, fitted-prior drift, runtime, heap and all four named-failure sections await evaluation.

<!-- results:end -->

## Licence

Application code: provisional MIT, see `LICENSE`; owner confirmation is needed before public release. Dataset terms
are separate/unverified. No Amazon rows, credentials, external provider implementations or secrets are committed.
