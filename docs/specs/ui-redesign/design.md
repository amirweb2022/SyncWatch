# SyncWatch UI Design Specification

## Identity and tokens

Cinema Minimal uses a dark-first canvas (`#09090F`), layered surfaces (`#181820`, `#20202A`), soft borders (`#30303B`), primary violet (`#8B5CF6`), accent violet (`#A78BFA`), and high contrast foreground (`#F5F5F7`). CSS variables in `app/globals.css` are the source of truth. Use restrained surfaces and borders; reserve color for action and state.

## Typography and localization

The Next.js App Router root layout loads Vazirmatn from `https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css` and Inter from `https://rsms.me/inter/inter.css` as global stylesheets. It preconnects to both origins. Locale-specific `lang` attributes select Vazirmatn with Tahoma/sans-serif fallbacks for Persian, and Inter with Segoe UI/Arial/sans-serif fallbacks for English. Global CSS font inheritance applies consistently to controls and content. CDN availability and actual browser font loading have not been verified. No font files or packages are downloaded or installed. Persian is the default locale; a compact language toggle stores an explicit choice in localStorage and updates `?lang=` so the choice follows lobby navigation. English content uses LTR direction, Persian uses RTL, and bidi-sensitive lobby codes and participant names are isolated.

## Components

The component system is custom-built with React, TypeScript, and Tailwind CSS. It is visually inspired by shadcn/ui's minimalist principles only. The shadcn/ui component library, CLI, and generated components are not installed or used. Semantic token classes (`.surface`, `.surface-raised`, `.control`, and `button-*`) keep surfaces consistent. Only application-needed custom components are implemented: lobby header, locale toggle, member list, video stage, and share controls. Native select and video elements avoid fragile homemade menus/dialogs. Inputs have labels, touch targets are at least 44px, buttons expose visible focus states, and status/error text uses live regions.

## Responsive behavior

Implemented layout behavior: the entry form becomes two columns at the medium breakpoint. The lobby uses a full-width video first, then session controls below on narrow screens; at the large breakpoint it uses a 300px session rail beside an expansive stage. The video keeps 16:9 sizing and is capped by viewport height. Layouts use wrapping controls and no fixed-width mobile sidebar. Lobby page padding accounts for device safe areas. Browser verification is pending: there is no browser automation dependency or configured browser tooling, so actual viewport checks at 320, 375, 430, tablet, laptop, and wide desktop have not been performed.

## RTL, accessibility, motion

Persian remains RTL and English content LTR at the page level; mixed codes/names use `<bdi>`. Implemented accessibility affordances include focus visibility, semantic headings, input labels, live status/error messages, reduced-motion styles, and keyboard-operable native controls. Their behavior has not been verified in a browser or with assistive technology. Browser-native video control orientation and explicit play gestures support autoplay recovery. No custom dialog, tooltip, or toast is needed by the current application flow.
