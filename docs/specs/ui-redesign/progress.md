# UI Redesign Progress

The Cinema Minimal redesign covers the entry page and existing lobby/video flow. The reusable UI is custom-built and visually inspired by shadcn/ui; the shadcn library, CLI, and generated components are not used. Session ownership remains with `LobbySession` and `StreamSession`; no WebRTC, capture, signaling, presence, election, or reconnect behavior was changed. CSS tokens and shared control classes live in `app/globals.css`; the layout is responsive and keeps the stage first on mobile. A Persian/English toggle follows the lobby URL and remembers explicit selection.

## Verification

**Implemented:** Global Vazirmatn and Inter CDN stylesheets and preconnects in the Next.js root layout; root/localized language attributes select the matching font family, with system fallbacks. Global font inheritance covers page content and native controls. RTL/LTR behavior remains locale-driven. No font files or packages were downloaded or installed.

**Verified:** `npm.cmd test` exit 0 (149 passed, 8 integration tests skipped); `npm.cmd run typecheck` exit 0; `npm.cmd run lint` exit 0 (one existing unused-import warning in `components/LocaleToggle.tsx`); `npm.cmd run build` exit 0 (same warning).

**Pending:** Browser access is unavailable, so actual CDN stylesheet/font requests and rendered font switching are unverified. Browser responsive and accessibility checks also remain pending. Manual font check: open the entry page in Persian and inspect computed font/loading requests for Vazirmatn, switch to English and confirm Inter is used, then repeat on a lobby route and verify layout direction remains RTL/LTR respectively. If either CDN is unavailable, confirm text remains readable with system fallback fonts.
