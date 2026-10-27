# SyncWatch UI Redesign Tasks

1. **Implemented; font loading pending — Design tokens and typography foundation.** Semantic CSS variables, focus/motion defaults, and fallback stacks are present. Required Vazirmatn and Inter assets are unavailable, so actual font loading is incomplete.
2. **Complete — Custom UI primitives.** Custom CSS/React only, visually inspired by shadcn/ui; no library, CLI, or generated components. Native select and inline SVGs keep the footprint small.
3. **Complete — Landing and entry.** Create/join flows retain handlers and show pending/error feedback; language toggle sets page direction.
4. **Complete — Lobby layout.** Reusable lobby header, code-copy and connection feedback, presence rail, retry/leave actions, safe-area padding, and responsive video-first composition.
5. **Complete — Video stage.** Responsive stage, waiting placeholder, explicit playback recovery, status label, and fullscreen action without changing stream ownership.
6. **Complete — Sharing controls.** Host/viewer states, quality selection, capture guidance, start/stop/request actions, and mobile guidance.
7. **Pending — Browser visual and device accessibility review.** No browser automation or browser access is available; responsive and accessibility verification has not been performed.
8. **Complete — Locale behavior.** Persian default, English override, preserved query parameters, and stored locale validation pass focused Vitest coverage.
9. **Complete with noted warnings — Final verification.** Focused UI tests: exit 0 (3 passed). `npm.cmd test`: exit 0 (149 passed, 8 skipped). `npm.cmd run typecheck`: exit 0. `npm.cmd run lint`: exit 0 (one unused-import warning in `LocaleToggle.tsx`). `npm.cmd run build`: exit 0 (same warning). The previous webpack cache and missing manifest ENOENT did not recur.
