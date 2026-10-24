# Bolt infrastructure handoff: Fair Review Re-Ranker

## Target and readiness

- Repository / branch: inner `review-reranker-stats` product repository, `build/s33-construction`; prepared M1–M6
  source. Use the owner-selected reviewed revision later. The outer planning/agentops shell is not the app root.
- App root: repository root containing this file, `package.json`, `index.html`, `src/`, `scripts/` and `tests/`.
- **Database: none**. This static single-user browser tool needs no cloud data service.
- Target: future static Vite import; no existing database connection or applied migration baseline.
- Hosting: future Bolt static hosting, unverified. Publication: **prepare only**.
- Bolt action: **inspect and prepare only**, after separately authorized GitHub import. No provisioning/publishing.
- Status: **source complete; runtime unverified**. No installed/resolved dependencies or lockfile; no typecheck,
  lint, tests, build, evaluation, browser, download or Bolt import executed. Not locally validated/ready.
- Owner prerequisites: close Dirty Mode for validation; verify runtime/pins; generate/review/commit lockfile;
  run deferred checks; separately select remote/revision/import. This work created no remote.

## Build and connection

| Item | Exact command or configuration |
|---|---|
| Runtime / package manager | Node `^20.9.0 \|\| >=21.1.0`, npm; actual local/Bolt versions unverified |
| First resolution | Verify pins/peers per D1, then `npm install`; lockfile absent/pending |
| Frozen install | `npm ci` after a reviewed `package-lock.json` exists; unrun |
| Dev | `npm run dev -- --host 127.0.0.1 --port <reserved-port> --strictPort` after agent-ports reservation; unrun |
| Build / output | `npm run build` → `dist/`, includes app/worker/Node typechecks; unrun |
| Type / lint / tests | `npm run typecheck`, `npm run lint`, `npm test`; all unrun |
| Evaluation | `npm run eval`, then `npm run eval -- --final`; not yet measured |
| Client file / public env | Not required; no Supabase client; `.env.example` comment only |
| Missing configuration behavior | Not required; browser offers Load sample/upload without remote setup |

## Database

| Order | Migration file | Tables / RLS / policies / triggers / extensions / RPCs | Applied status |
|---|---|---|---|
| Not required | Not required | Not required | Not required |

Access model, ownership checks, database seeds, migration retries and database Realtime permissions: **Not required**.
Do not add supabase-js, a database or backend placeholders to fit a template. Synthetic demo data is generated in
the worker; person-run fixture dumps are separate local artifacts.

## Functions

| Name / source | Caller + auth | Input / output | Resources + secret names | Deploy config |
|---|---|---|---|---|
| Not required | Not required | Not required | Not required | Not required |

CORS/preflight, JWT checks, server abuse controls, paid API limits, webhooks and platform credentials:
**Not required**. Computation lives in `src/core/` and a module worker.

## Server secrets to enter through settings

| Name | Consumer | Required / optional | Owner source |
|---|---|---|---|
| Not required | Not required | Not required | Not required |

Missing-secret behavior and public environment configuration: **Not required**. No secrets/provider credentials.
`providers` and `callledger` are deliberately absent because there are no model calls.

## Auth, storage, and external steps

| Backend requirement | Inventory |
|---|---|
| Auth providers, signup, confirmation, recovery | Not required |
| Site URL, OAuth/callback/recovery routes | Not required |
| Buckets, file policies, private uploads | Not required |
| Realtime publications/channels | Not required |
| Schedulers, durable workers, background jobs | Not required |
| Outside service accounts, API/OAuth registrations | Not required |
| Telemetry, paid providers, model secrets | Not required |

Rulings use browser localStorage and explicit JSONL download/import; review rows remain transient. This is not
cloud storage. No backend integrations/stubs exist. The optional **person-run Node** Amazon fetcher is outside
the hosted runtime and must never run during import, startup, demo or tests. Its source map is empty pending
official category/terms/current redirect-host inspection. It writes gitignored `data/local/` only. Do not upload
local source rows or sealed evaluation data to GitHub/Bolt. Dataset attribution/rights and coverage confirmation
remain human work documented in README and D9/D46–D48.

## Acceptance checks and receipts

| Check | Expected result | Outcome / receipt |
|---|---|---|
| Import/install/build | Correct inner root/revision; verified pins/lockfile; `npm ci` and `npm run build` pass | Pending; never run |
| Type/lint/tests | Commands above succeed without weakening tests/contracts | Pending; never run |
| Worker/sample/rulings/export | Journey, cancellation, hash replay and local downloads work | Pending; no browser |
| Static privacy | Only packaged assets load; no runtime external requests/review persistence | Pending; inspect Network/Application |
| Syntax / relative source interfaces | `.ts` syntax parsing and focused relative import/export inspection | Performed; not type/runtime validation |
| Schema/migrations | Not required | Not required |
| Function round trip | Not required | Not required |
| Auth / tenant isolation | Not required | Not required |
| Missing server secret | Not required | Not required |
| Cloud uploads / webhooks / jobs | Not required | Not required |
| Publication | Not required | Not required |

No measurements are reported. [docs/DEFERRED-VALIDATION.md](docs/DEFERRED-VALIDATION.md) owns pending checks;
README results remain `not yet measured`. A prepared prompt/build cannot prove hosting behavior or source rights.

## One prompt after separately authorized GitHub import

> Read BOLT-HANDOFF.md, README.md and docs/DEFERRED-VALIDATION.md in the imported **inner product repository** at
> the owner-selected reviewed `build/s33-construction` revision. This is **inspection and preparation only** for
> the existing local-only React/TypeScript/Vite app. **Database: none**; every backend resource is Not required.
> Source is complete; install/type/lint/test/build/evaluation/browser/Bolt checks are unrun and the lockfile is
> absent. Inspect runtime/package compatibility and actual scripts/configuration, identify concrete gaps and
> prepare a reviewable validation/import plan. Preserve product design, deterministic core, local review handling
> and person-run-only downloads. Do not invent measurements, run Amazon fetching, upload local data, infer source
> rights, add database/auth/functions/secrets, create/change cloud resources, enable schedules or publish. Report
> exact pending commands and owner/external blockers.
