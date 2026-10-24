# Limitations and failure reporting

All outcomes below are **not yet measured**. M1–M6 source/test source is written, but dependencies, TypeScript,
lint, tests, build, evaluation, browser behavior and Bolt import have not been run. Executed checks are syntax
parsing and source inspection only. No real data has been downloaded or licensed for this run.

## Evaded attacks

**not yet measured**. Generated `results/results.md` (or `<out>/results.md`) has an **Evaded attacks** section
with injected/flagged counts for fully or partially evaded planted spans. Recall applies only to sampled generator
shapes: no real-world recall estimate or lower bound is inferred. Different held-out attack families reduce
direct tuning circularity but cannot represent every campaign. Drip attacks can avoid volume thresholds; the
drip fixture's expected miss is deliberate. Distributed cross-product/user coordination is outside this non-graph
detector. The optional fetcher retains no reviewer identifiers.

## Flagged organic bursts

**not yet measured**. Generated **Flagged organic bursts** reports organic reviews inside flagged spans;
detector tables report organic-downweight share on synthetic labelled data. Real flags remain unverified evidence,
not ground-truth fraud. Authentic events can change both volume and rating distribution. Volume-only spikes do
not downweight, but this cannot guarantee zero organic harm. Restore remains a human choice.

## Items whose rank moved most versus `mean`

**not yet measured**. See generated **Top-10 items by |rank change vs mean| per method**. Shrinkage, verification,
recency and burst factors intentionally move ranks. Movement alone establishes neither error, fairness improvement
nor causal quality. Absolute posterior mean is the default EB key; within-category percentile is display-only.
The alternative key is the lower endpoint of a **two-sided 90%** interval. Wilson concerns top-box share, EB
concerns mean stars; their intervals concern different quantities. `mean` and `bayes_global` have no interval.
Weighted normal approximations and very small samples need empirical checking; intervals do not cover arbitrary
dependence, source selection, prior misspecification or adversarial contamination.

## Categories on the global prior

**not yet measured**. See generated **Categories on the global prior (both runs)** and paired fitted-prior
snapshots in `manifest.json`. Categories with fewer than 20 fitting items use global fallback. Category evidence
is **synthetic-only**; two possible broad Amazon categories are an unverified secondary check, not evidence of
general category calibration, subcategory behavior or equal representation. Prior drift and fallback/source
changes under attack are retained because category priors can themselves be wrong.

## Detector departures, selection and caps

The rating-shift statistic is an absolute mean difference: a **two-sided test**, a declared departure from the
spec's ambiguous one-sided wording so both promotion and bombing are detectable. It also requires a count spike.
Count-based selection, overlapping/dependent windows and permutation assumptions make nominal p-values heuristic
evidence scores, not fraud probabilities.

Holm correction is **per item**, not catalogue-wide. It does not guarantee catalogue-wide false-flag control
after screening; organic-downweight share and real unverified-flag counts need separate reporting. At most five
selected spans/item and 5,000/dataset consume the budget, including reserved thin-reference slots. Untested
candidates remain `partial`, thin history/reference `unassessable`; neither means clean. Every accepted review
retains positive weight; overlapping spans use the minimum factor once. Restoring one span does not remove a
different overlapping span's factor. Exports retain rulings and completeness.

**C15:** candidate windows end only on days with accepted reviews. Empty-day-ending windows are not evaluated;
their count cannot exceed the window ending on the preceding nonempty day, but a shifted baseline can change z.
Flags do not re-mask later baselines, so multi-day activity can contaminate its own baseline. Candidate-day
masking is a deferred alternative, not implemented. A 5,000-test cap bounds test count, not permutation-vector
work, elapsed time or memory. No 200k-row throughput/responsiveness claim exists before profiling.

## Evaluation boundaries and source coverage

The claim is a proposed non-inferiority margin and conditional planted-damage comparison, not a measured win.
Nonpositive baseline damage makes check (b) **not assessable**. Low target/category support is **insufficient
support**. Undefined metrics/bootstrap values cannot establish a claim; cold-start cohorts below 20 are
underpowered. Synthetic intervals use known observed-star/top-box truth; real comparisons with later ratings
are **predictive agreement**, never generative calibration.

**C7:** after the final gate, priors refit **all items' pre-cutoff reviews**, both dev and held-out, scoring only
held-out items. Targets never fit priors, recency clocks or detector history. This matches a whole-catalogue fit.
The partition-local alternative was considered and is not implemented; it can yield different priors/fallbacks.
Dev tuning never receives held-out rows. The sealed adapter is API isolation, not encryption/filesystem security.
Failed final reads consume attempts; rereads remain disclosed. Never regenerate/retune because final outcomes
or support disappoint.

The person-run Amazon fetcher has no configured category/URL and no verified licence/current CDN allowlist.
It drops reviewer ids, titles/text/images and records bounds/rejects/truncation locally. EOF and observed min/max
timestamps do not prove representative complete temporal coverage. Capped/error downloads or unknown coverage
cannot support a temporal headline. Local evaluation requires matching SHA-256/row-count metadata, complete EOF
without rejects/truncation and explicit human coverage confirmation before sealing/tuning. That evidence freezes
into provenance and is required before final admission. Human attestations are not independently verified by
code; editing a sidecar is not a remedy for incomplete data. No real-source rights or results are claimed.

## Local behavior and activation

CSV parsing loads bounded text into memory; transient allocations exceed input size. Timeline aggregation changes
display only. Rulings persist, review rows/configuration do not; reproduce detector edits for replay. Storage and
downloads can fail, corrupt logs are retained, and multi-tab edits are unsynchronized. Private-mode fallback,
formula safety, cancellation, rendering and accessibility remain unverified. No model/Jev, backend, database,
auth, hosted workflow or catalogue mutation is implemented or required. Pins, missing lockfile, portability and
deployed privacy behavior remain pending in [DEFERRED-VALIDATION.md](DEFERRED-VALIDATION.md). Application MIT is
provisional; dataset terms are separate.
