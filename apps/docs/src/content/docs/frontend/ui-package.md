---
title: Shared UI Package (@repo/ui)
description: Structure, theming (Tailwind v4 + CSS variables + dark mode), and consumption of the packages/ui design-system package.
sidebar:
  order: 4
---

`packages/ui` is the monorepo's design-system package. Unlike `apps/web`'s
feature folders, it follows the plain shadcn/ui convention: one kebab-case
file per component, imported through per-subpath package exports.

## Structure

```
packages/ui/
  src/
    components/     # 50 components: button.tsx, dialog.tsx, sidebar.tsx, list-surface.tsx, ...
    primitives/      # container.tsx, section.tsx, page-layout building blocks
    theme/           # constants.ts (COLOR_THEMES), types.ts, index.ts, the color-theme contract
    animations/       # constants.ts (framer presets), classes.ts (the CSS half), index.ts
    hooks/            # use-mobile.ts
    lib/              # utils.ts (the `cn` class-merge helper)
    styles/            # globals.css, Tailwind v4 entry + every CSS-variable theme
  .storybook/         # Storybook config (component gallery, isolated from apps/web's own Storybook)
  components.json      # shadcn CLI config (for pulling in new primitives)
```

Each component is exported from `package.json`'s `exports` map as its own
subpath, e.g.:

```json
"./button": { "import": "./src/components/button.tsx" },
"./sidebar": { "import": "./src/components/sidebar.tsx" },
"./theme": { "import": "./src/theme/index.ts" },
"./styles/globals.css": "./src/styles/globals.css"
```

So a consumer imports `import { Button } from '@repo/ui/button'` rather than
a single barrel, this keeps tree-shaking simple and matches the shadcn
convention where each component is meant to be copy-paste-able. There are 58
export entries today (components, primitives, hooks, theme, the animation
presets, the `cn` and overlay utilities, and the global stylesheet).

Component source files are plain TSX with `forwardRef`, Radix primitives, and
`class-variance-authority` for variants, the same pattern the codegen's
`pnpm new:component ui/<Name>` scaffolds (see the
[feature folder architecture doc](/frontend/feature-folder-architecture/)).

## The product primitives

Most of `packages/ui` is stock shadcn. A smaller set was written for this
product specifically, and those carry rules a consumer has to know, because each
one exists to stop a divergence that had already happened.

| Component      | Subpath                  | Why it exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ListSurface`  | `@repo/ui/list-surface`  | Owns the chrome AROUND a table, which is where every list had diverged: tabs with count badges, the toolbar, the bordered card, the footer. `state` is a prop and loading/empty/error REPLACE the table, which is the cure for a bare header row floating over nothing.                                                                                                                                                                                                                                                                           |
| `Pagination`   | `@repo/ui/pagination`    | A range summary plus previous / next, and nothing else. Every list in the app pages by keyset cursor, which names a row rather than a position, so numbered buttons would be controls nothing can honor; the numbered mode existed for one list's OFFSET arm and went with it. The total is not lost with the buttons: it rides `labels.summary`, which the consumer formats, so a list that can afford a count says "of 312" and one that cannot (audit) states its range alone. Every string is a prop: the package has no translation catalog. |
| `Combobox`     | `@repo/ui/combobox`      | The picker for a list you have to FIND something in, as opposed to `Select`'s bounded enum you read in one glance. `searchPlaceholder` is required, so adding one forces you to name what the user would type; if that feels silly, you wanted `Select`. Pass `search` + `onSearchChange` to switch off client filtering and let the server own the query.                                                                                                                                                                                        |
| nav-rail parts | `@repo/ui/nav-rail`      | The reusable half of a navigation shell: brand lockup, group label, link treatment, footer identity block. The CONTAINER stays per-shell (the app shell wraps `Sidebar` for the icon rail, Cmd+B and the mobile sheet). Density (`comfortable` or `relaxed`) is the one axis a second shell would change. It lives here rather than in `features/layout` so a second shell can reuse it without a cross-feature import.                                                                                                                           |
| `PageSkeleton` | `@repo/ui/page-skeleton` | The content-region placeholder a shell shows while a route resolves, keeping its frame instead of blanking to a centered spinner. Deliberately a silhouette (`list`, `detail`, `cards`) rather than a gray box, with `role="status"`, an accessible `label` and `aria-busy`.                                                                                                                                                                                                                                                                      |
| `StatTile`     | `@repo/ui/stat-tile`     | Tones the figure only; the icon chip stays brand-tinted in every state, per the design. Deciding when a figure is alarming is the consumer's policy, passed in as `tone`.                                                                                                                                                                                                                                                                                                                                                                         |
| `StatusPill`   | `@repo/ui/status-pill`   | The state chip as a TINT (`bg-danger-bg text-danger`), never `Badge`'s solid `destructive` fill. Both treatments were once live on the same record, on two screens that link to each other. Consumers map their domain states onto four semantic ones at the edge of the domain.                                                                                                                                                                                                                                                                  |

## The motion system

`@repo/ui/animations` is one scale in two halves, and they have to be read
together because the CSS half's Tailwind classes are the numeric values from the
framer half.

- **`constants.ts`** holds the scale: `durations` (`fast` 0.12s, `base` 0.16s,
  `moderate` 0.2s, `slow` 0.25s as the ceiling), `distances` (4/6/8px), the
  0.98 scale step, and `stagger` for a freshly loaded list, capped at 12 rows so
  a 100-row table does not shimmer top to bottom.
- **`classes.ts`** holds the class strings: `MOTION_FADE_CLASS`,
  `MOTION_DIALOG_CLASS`, `MOTION_ANCHORED_CLASS`, `MOTION_PANEL_CLASS`,
  `MOTION_ROW_ENTER_CLASS`, `MOTION_PRESS_CLASS`, `MOTION_CROSSFADE_CLASS`,
  `MOTION_LAYOUT_CLASS`.

Two rules govern which half to reach for.

**CSS first, framer second.** An overlay, a row or a hover is a keyframe or a
transition, and those cost zero runtime bytes and zero React work.
`framer-motion` is reserved for the two things CSS cannot do: an element that
travels between two DOM positions (the tab underline), and one that has to
finish animating after React would have unmounted it (a removed row).

**Reduced motion is inside every class string**, not a separate opt-in, and it
is `animate-none!` rather than a shortened duration. Radix `Presence` treats a
computed `animation-name: none` as "nothing to wait for" and unmounts
immediately, so an exit still completes; a shortened animation would still move
the pixels, which is the thing being asked not to happen. Framer-driven motion
asks `useReducedMotion()` and renders the static form.

The scale is tuned for a work app people read for eight hours a day: motion's
one job is to explain that something arrived, left or changed place, and
anything seen four hundred times has to be over before it registers as an event.
Springs are reserved for surfaces that should feel physical, which here means a
drawer, a sheet or a popover and nowhere else. A spring on a row or a badge is
overshoot on data, and data must not wobble.

## Enforcement: `@repo/ui` and the architecture rules

`packages/ui`'s `eslint.config.js` spreads
`@repo/eslint-config/react-architecture`, the same config `apps/web` uses. Its
seven structural rules (folder shape, cross-feature imports, etc.) all key off
a `src/features/**` glob that does not exist in this package, so they are
inert here. Only **`interface-prefix-i`** applies (scoped broadly to
`src/**/*.{ts,tsx}`), every interface in `@repo/ui`, including
`IThemeSelectorProps`, `IColorThemeDefinition`, etc., is `I`-prefixed.

## Theming

### Tailwind v4 + CSS custom properties

`packages/ui/src/styles/globals.css` is the single entry point:

```css
@import 'tailwindcss';
@import 'tw-animate-css';
@import '@fontsource-variable/geist';

@custom-variant dark (&:is(.dark *));

:root {
  /* base (violet) light-mode variable set */
}
.dark {
  /* base (violet) dark-mode variable set */
}
[data-theme='ocean'] {
  /* ocean light-mode overrides */
}
[data-theme='ocean'].dark {
  /* ocean dark-mode overrides */
}
/* ...repeated per color theme... */
```

All color tokens are defined in the OKLCH color space (e.g.
`--primary: oklch(0.541 0.281 293.009);`), covering the standard shadcn
token set: `background`/`foreground`, `card`, `popover`, `primary`,
`secondary`, `muted`, `accent`, `destructive`, `border`/`input`/`ring`,
`chart-1..5`, and a parallel `sidebar*` set for the sidebar component's own
surface. Tailwind utility classes (`bg-background`, `text-muted-foreground`,
etc.) read these variables, so a theme swap is a pure CSS operation with no
JS re-render of the tree.

### Dark mode

Controlled by a `.dark` class on `<html>`, toggled by the `@custom-variant
dark (&:is(.dark *))` Tailwind directive. `apps/web/src/lib/theme.ts` owns
applying it: `applyTheme(theme)` resolves `'system'` via
`window.matchMedia('(prefers-color-scheme: dark)')` and toggles the class;
`watchSystemTheme(callback)` subscribes to OS-level scheme changes so a
`'system'` preference updates live.

### Color themes

`ColorTheme` (`packages/ui/src/theme/types.ts`) is a union of seven values:
`violet` (default) | `ocean` | `forest` | `amber` | `rose` | `lime` | `slate`.
`COLOR_THEMES` (`theme/constants.ts`) pairs each with a display name,
description, and light/dark preview swatch colors, used by the
`ThemeSelector` component (`packages/ui/src/components/theme-selector.tsx`) to
render a swatch-and-label picker plus a light/dark/system mode-cycle button.
Applying a color theme is `document.documentElement.setAttribute('data-theme',
theme)` (or removing the attribute entirely for the default `violet`, since
`:root`/`.dark` already carry violet's values), see
`apps/web/src/lib/theme.ts`'s `applyColorTheme`.

### Flash-of-wrong-theme prevention

Because both the dark/light mode and the color theme are stored in
`localStorage` (via `apps/web`'s persisted `useUIStore`) and applied by React
only after mount, `apps/web/public/theme-boot.js`: a plain external script
tag loaded from `index.html` before any bundle, reads the same
`ui-store` localStorage key synchronously and applies the `dark` class before
first paint. It is a separate, external file (not an inline `<script>`)
specifically so a strict CSP can omit `'unsafe-inline'` from `script-src`.

## How apps consume `@repo/ui`

| App            | Consumes `@repo/ui`? | Notes                                                                                                                                                                                                                                                     |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`     | Yes                  | Primary consumer. Imports `./src/styles/globals.css` from `apps/web/src/index.css` (`@import '../../../packages/ui/src/styles/globals.css'; @source '../../../packages/ui/src';`) and every UI primitive/component by subpath.                            |
| `apps/docs`    | No                   | Astro + Starlight. Documents the design system in prose and re-declares the palette as literal hexes in `apps/docs/src/styles/theme.css` (it cannot import the Tailwind theme), which is why `pnpm check:contrast` holds that copy against `globals.css`. |
| `apps/desktop` | No                   | The Electron **main process** has no UI of its own, it hosts `apps/web`'s built output as the renderer (copied into `dist/renderer` at build time). `apps/desktop/package.json` does not depend on `@repo/ui`.                                            |

`apps/web` is currently the **only** workspace that consumes `@repo/ui`. It has
not always been: `apps/system-design` was a fourth app and a real consumer, and
an audit twice concluded a component was unused after grepping only `apps/web`
and `apps/desktop`. That app is retired, but the discipline outlives it. Before
calling a component dead, check every app and package in the workspace, and grep
the export names as well as the `@repo/ui/<name>` subpath: an intra-package
relative import (`from './collapsible'`) never matches a subpath grep, which is
exactly how `list.tsx`'s use of `collapsible` stayed invisible until it was
looked for by name.

## Storybook

`packages/ui` ships its own Storybook (`.storybook/main.ts`,
`.storybook/preview.ts`, `storybook.css`) separate from `apps/web`'s
Storybook instance, used to preview components in isolation with the
`@storybook/addon-themes` addon (so stories can be viewed against each color
theme / light-dark mode). Run it with:

```bash
pnpm --filter @repo/ui storybook          # dev server, default port 6006
pnpm --filter @repo/ui build-storybook    # static build (packages/ui/storybook-static/)
```

`apps/web` also runs its own Storybook on a different port (`storybook -p
6007`, see `apps/web/package.json`) for feature-folder component stories.

## Notable dependencies

`packages/ui/package.json` pulls in Radix primitives (`radix-ui`,
`@radix-ui/react-dialog`, `@radix-ui/react-popover`), `@tanstack/react-table`
and `@tanstack/react-virtual` (for `data-table.tsx`), `@dnd-kit/*` (for
`kanban.tsx`), `@tiptap/*` (for `editor.tsx`), `cmdk` (command palette),
`sonner` (toasts), `framer-motion` (animations), and `react-hook-form` +
`@hookform/resolvers` (the `form.tsx` primitive `apps/web` feature forms build
on). `react`/`react-dom` are peer dependencies (`^19.0.0`), so the version is
whatever the consuming app pins.
