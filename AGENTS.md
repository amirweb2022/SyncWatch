# Agent Instructions

## Project

SyncWatch is a personal two-person screen-share watch party. Read `PRD.md` before implementing features.

## Stack and hard rules

- Next.js App Router, TypeScript strict, Tailwind CSS, Zustand.
- Supabase Realtime Broadcast and Presence only. No Supabase Auth, tables, DB, API routes, or custom server.
- Native `RTCPeerConnection` and `getDisplayMedia`; no media server or WebRTC helper library.
- No `any`. Validate untrusted realtime payloads before use.
- Keep files small and single-purpose. Isolate pure logic and unit-test it with Vitest.
- Keep lobby/chat ephemeral; only display name may use localStorage.
- Preserve RTL and Persian-first localization.

## Commands

- `npm run dev` — local development
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — strict TypeScript check
- `npm test` — Vitest pure-function suite

## Structure

- `app/` — routes, layout, global styles
- `components/` — UI components
- `lib/realtime/` — Supabase client, channel, event types
- `lib/webrtc/` — peer management, capture, ICE, media constraints
- `lib/` — shared config, localization, lobby code generation
- `store/` — Zustand lobby, stream, and chat state
- `tests/` — pure-function unit tests

## Conventions

- Prefer explicit exported types and narrow unions for event/state shapes.
- Keep browser-only APIs in client-side modules/components.
- Use environment variables only for public Supabase and optional TURN config listed in `.env.example`.
- Keep UI text in the locale dictionary; never render chat via HTML injection.
- Avoid adding dependencies unless a stated requirement needs them.

## Definition of Done

- [ ] Acceptance criteria in `PRD.md` are met.
- [ ] `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` pass.
- [ ] No `any`, API routes, server code, database, or Auth were added.
- [ ] Realtime errors, reconnects, cleanup, and permission failures are handled.
- [ ] New pure logic has focused Vitest coverage; docs and `.env.example` match behavior.
## Agent skills

## Skills and Development Workflow

- Use a docs-first, spec-driven development workflow.
- Before planning or implementing a task, inspect the available installed skills.
- Select and read only the skills relevant to the current task.
- Follow the selected skill's instructions.
- Do not invoke unrelated skills.
- Never assume a skill exists without checking.
- Follow strict TDD for every implementation task: RED → GREEN → REFACTOR.
- Write failing tests before production code.
- Keep tasks small and independently verifiable.
- Update tasks.md and progress.md after each task.
- Preserve architectural decisions in design.md.
- If a skill conflicts with PRD.md or an explicit project constraint, report the conflict before proceeding.
- Never implement multiple tasks in one execution unless explicitly requested.

### Issue tracker

Issues and specs live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context layout with `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
