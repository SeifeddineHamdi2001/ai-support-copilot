---
name: phase-check
description: Definition-of-done checklist to run before declaring any phase of this project complete — lint, typecheck, tests, migrations check, docker verification, requirement coverage, and commit. Use whenever a phase or feature is about to be reported as done, or when the user says "check", "verify", or "are we done".
---

# Phase check (definition of done)

Never report a phase as done until every applicable item passes. Report results as a short checklist with
✅ / ❌ and the exact failing output for ❌ items, then fix and re-run.

## 1. Static checks
```bash
pnpm -r lint
pnpm -r typecheck
pnpm check:migrations        # no DROP of vector/FTS indexes
```

## 2. Tests
```bash
pnpm test        # unit, all workspaces
pnpm test:int    # integration (Testcontainers; needs Docker)
pnpm test:e2e    # only from Phase 8 on
```
If Docker is not available locally (Windows Hyper-V issue), say so explicitly, run unit tests only, and
note that integration tests must be run on the VPS or in CI. Never mark integration tests as passing if
they were not run.

## 3. Runs end to end
- `docker compose up -d --build --wait` then `curl -fsS localhost:3001/api/v1/health`.
- With `LLM_PROVIDER=mock` and no `GEMINI_API_KEY` set at all.
- Seed data present (tickets list non-empty, KB documents INDEXED from Phase 5 on).
- From Phase 4 on: open the web app and click through the phase's flow.

## 4. Requirement coverage (cumulative)
Tick what the phase delivered against the spec:
- [ ] Tickets: create, update, assign, track status (state machine + audit timeline)
- [ ] LLM classification by intent and priority (schema-validated, fallback works)
- [ ] RAG responses with source citations (allow-listed, "no grounded answer" path)
- [ ] Escalation recommendation (rules + LLM signals, accept/dismiss)
- [ ] REST API + relational DB with validation and persistence (Problem Details, 409s, transactions)
- [ ] Functional frontend for all of the above
- [ ] Automated tests, Docker setup, documentation

## 5. Hygiene
- `git status` clean of `.env`, build output, `node_modules`, screenshots not meant for the repo.
- `docs/DECISIONS.md` updated with any decision made in this phase (what, why, alternative rejected).
- `.env.example` contains every env var the code reads (grep `process.env` / ConfigService keys).
- No `console.log` debugging left, no commented-out code blocks, no TODOs without a note in README
  "Known limitations".

## 6. Commit
Small conventional commits that tell the story (`feat(tickets): …`, `test(ai): …`, `docs: …`).
After Phase 4: `git tag mvp-1`. After final check: `git tag v1.0`.

## 7. Report to the user
Three to six lines: what works now, what was tested and how, anything skipped and why, next phase.
