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

The code and documentation are **written by coding agents** (Claude Code subagents working from the plan in the
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

## Validating later

Once installs are authorised, from this folder:

```sh
npm install          # resolves the pinned versions and creates package-lock.json
npm run typecheck
npm run lint
npm test
npm run build
```

The full list, with what each check covers, is in `docs/DEFERRED-VALIDATION.md`.

## Licence

MIT (see `LICENSE`), committed provisionally; the owner confirms the licence before any public release.
