# Start here

This folder is the starting point of your project repo. Everything in it is read by Claude Code automatically.

```
copilot-starter/
├── CLAUDE.md                     project spec, pinned stable stack, rules (loaded every session)
├── PROMPTS.md                    one prompt per phase — paste them in order
├── START-HERE.md                 this file
└── .claude/
    └── skills/
        ├── frontend-design/          Anthropic's official UI design skill
        ├── support-console-ui/       this app's visual direction + screen layouts
        ├── nestjs-api-conventions/   errors, validation, locking, transactions, state machine
        ├── llm-structured-output/    provider interfaces, mock providers, validate → repair → fallback
        ├── rag-hybrid-search/        chunking, pgvector + full-text RRF search, citations, migrations
        └── phase-check/              definition of done before any phase is reported complete
```

## Setup (Windows)
1. Unzip and rename the folder to your project name, e.g. `ai-support-copilot`.
   `.claude` is a hidden folder — make sure it came with the unzip (in Explorer: View → Show → Hidden items).
2. Install Node.js 22 LTS and pnpm (`npm i -g pnpm`). Install Git.
3. Open a terminal in the folder:
   ```
   git init
   claude
   ```
4. Check the skills loaded: ask Claude Code "which skills do you have?" — you should see the six above.
5. Paste **Phase 1** from `PROMPTS.md`. Use plan mode (Shift+Tab) for phases 1, 4 and 5.
6. After each phase, Claude Code runs the `phase-check` skill. Review the diff, commit, `/clear`, next phase.

## If Docker Desktop doesn't work on your laptop
Develop with Postgres on your VPS (SSH tunnel: `ssh -L 5432:localhost:5432 user@vps`) and run
`docker compose up --build` on the VPS to verify. CI (Phase 8) also proves the Docker setup works.

## Before you submit
Delete `START-HERE.md` and `PROMPTS.md` from the repo (or move them out) — or keep `PROMPTS.md` if you want
to show reviewers how you used AI tooling; be ready to talk about it in the interview either way.
