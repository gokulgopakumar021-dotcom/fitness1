# Iron Log design system

Direction: Reshape-style personalised dashboard + Hevy-style clean logging, in Iron Log's own dark theme with the volt/lime accent. Flat surfaces, one border treatment, no decorative gradients or glows.

Source of truth: `src/index.css` (tokens) and `src/components/ui/` (primitives, exported from `components/ui/index.ts`). `ThemeContext` toggles `.dark` / `.light` on `<html>`; every token below switches with it.

## Tokens

| Area | Tokens / utilities | Notes |
| --- | --- | --- |
| Surfaces | `bg-canvas`, `bg-surface`, `bg-surface-2`, `bg-surface-3` | canvas < surface < surface-2 < surface-3 |
| Borders | `border-line`, `border-line-strong` | line = resting, strong = raised/hover |
| Text | `text-zinc-100…500` (flips in light), `--text-primary/secondary/muted` | prefer `text-white` for primary, `text-zinc-400` for secondary |
| Accent | `bg-accent`, `text-accent-ink`, `bg-accent-hover` | dark `#ceff00`; light `#4d7c0f` (contrast-safe). Use `text-volt-adaptive` for accent-coloured text |
| Status | `success`, `warning`, `danger`, `info` (+ `/10` bg, `/30` border) | see `Badge` |
| Radius | `rounded-card` 16px, `rounded-control` 12px, `rounded-t-sheet` 24px | cards/panels = card; buttons, inputs, nested sub-surfaces = control |
| Type | Plus Jakarta Sans; mono for numbers. `text-label` = 11px micro-label | Page title `text-2xl sm:text-3xl bold`, section `text-base semibold`, body `text-sm`, caption `text-xs`, micro `text-label` |
| Spacing | Tailwind 4px scale. Card padding `p-4 sm:p-5`; gap between cards `gap-3 sm:gap-4`; page sections `space-y-6` | `Card pad=` encodes this |
| Overlay | `bg-overlay` | 70% black on dark, soft slate on light |
| Charts | `--chart-1…5`, `--chart-grid`, `--chart-axis`, `--chart-ring`; utilities `bg-chart-1`, `border-chart-2`… | series 1 = accent; pass `var(--chart-n)` (not hex) as `accentColor` |

## Components (`components/ui`)

- **Card** — `tone` default/raised/accent/ghost, `pad` none/sm/md/lg, `interactive` for tappable rows.
- **Button** — primary / secondary / ghost / danger; sm 36px, md/lg ≥44px; `loading`, `icon`; `iconOnly` for square icon buttons (always pass `aria-label`). Don't fight padding with `px-*` overrides.
- **Input / Select / Textarea / Field** — label, hint, error (announced, `aria-invalid`), `mono` for numeric entry. 44px tall, accent focus border. Use these instead of hand-styled `<input className=…>`. `compact` keeps the 44px height but tightens padding and centers text, for dense numeric grids such as workout set rows.
- **Modal** — dialog semantics, Esc/backdrop close, scroll lock, focus restore; bottom sheet on phones. Inline `onClose` arrows are safe (the latest one is read from a ref, so typing never loses focus). `closeLabel` names the close button.
- **EmptyState / ErrorState / LoadingState / Skeleton** — one trio for "no data", "failed", "pending"; Skeleton when the layout is known.
- **Badge, ProgressBar, SegmentedControl, MetricCard, PageHeader, SectionHeading** — unchanged API, now on the radius/label tokens.
- **SectionNav** — in-page category navigation: scrollable pill row on phones (active pill kept in view), vertical list from `lg` (icons desktop-only). Buttons switch a panel and set `aria-current`; pair with an `sr-only` `h2` naming the active panel.
- **Charts** (`components/common/Charts.tsx`) — `LineChart` / `BarChart` use chart tokens, so they follow the theme; each `LineChart` has its own gradient id. `LineChart responsive` draws at the container's real width (labels keep their size on phones); `BarChart maxLabels` thins x labels. Points and bars respond to tap and keyboard focus as well as hover.

Legacy `.reshape-card`, `.reshape-card-subtle`, `.reshape-card-interactive` still work and now share the same radius tokens. Prefer `<Card>` in new code.

## Workout tracker (reference screen)

`WorkoutSessionTracker` is the reference for dense logging UI: a sticky summary header (name, clock, set progress, primary Finish), a toolbar row, `ExerciseCard` (`components/workouts/`) with `SetRow` grid rows, shared `Modal` for every dialog, and a compact `RestTimer` dock. Notes for reuse:

- `cn()` is a plain joiner, not a class merger. Do not rely on a later class overriding an earlier one for the same property; use a prop (`compact`, `iconOnly`) or a responsive variant (`max-sm:`, `sm:`) instead.
- `position: sticky` inside `<main>` needs `overflow-x-clip` (not `-hidden`) on `<main>`, since `hidden` turns it into a scroll container.

## Rules

1. No hex colours in components; use tokens (charts: `var(--chart-n)`).
2. One card style: `Card` (or the legacy class). No per-screen shadows, glows, or gradient fills.
3. Touch targets ≥44px on mobile; inputs ≥16px font on phones (handled globally).
4. Every screen needs a loading, empty and error state from the shared trio.
5. Check both themes before merging.

## Adoption (audit of `main`, Oct 2026)

Screens already on `ui/`: Dashboard (+ scorecard, muscle map), Navbar, Auth, Landing, Video Library, Adaptive Review modal, Nutrition (view, goal gauge, Goal Wizard, hydration), Progression, Home.
Not yet on `ui/`: Workout tracker, Reports, Timeline, Coach Iron, Plans, most modals. Settings & Profile moved onto `ui/` in phase 4 (see Settings conventions).

Suggested redesign order: (1) Workout tracker, (2) Nutrition, (3) Progression / Overload Engine, (4) Timeline + Reports, (5) Home, (6) Coach Iron, (7) Body & Body Scan, (8) Settings + Plans + remaining modals.

## Nutrition conventions

- Macro colours come from `MACRO_META` in `components/nutrition/MacroBar.tsx` (protein = `--chart-1`, carbs = `--chart-2`, fat = `--chart-4`). Use it for any new macro UI rather than picking colours per screen.
- Calories and macros are summarised once, in `NutritionGoalGauge`. Don't repeat the same totals in another card on the same screen.
- Hydration uses `info` for progress and `success` once the target is reached.
- Nutrition dialogs use `Modal` + `Input`/`Select`/`Textarea`; Barcode Scanner (camera UI) is intentionally untouched and still uses its own styling.

## Progression conventions

- Screen: `components/progression/ProgressionView.tsx`. Engine (`utils/progressionEngine.ts`) and `utils/calculations.ts` are the source of truth for every number; the screen never recomputes volume, 1RM or top weight.
- Display-only helpers live in `utils/progressionPresentation.ts` (date-range filter, last-vs-previous comparison, weight-record list, signed-delta formatting). Keep new presentation logic there so it can be unit-tested.
- Series colours: line charts pass `var(--chart-1)` (load) and `var(--chart-2)` (reps); never hex.
- Direction of change is always icon + signed text (`DeltaChip`), never colour alone. Overload status is a `Badge` with an icon and a text label.
- Date range (30 days / 90 days / All time) only affects the trend charts. Headline metrics, the last-vs-previous comparison and the record list always use full history.
- Exercises with no completed sets show `EmptyState` instead of zeroed metrics or empty charts; a range with no sessions offers "Show all time".

## Home conventions

- Screen: `components/home/HomeView.tsx` (data load, header, layout) + `HomeSections.tsx` (one card per purpose: workout, nutrition, progress, Coach Iron, body, more). The older "Overview" tab (`DashboardView`) is a separate screen and was not changed.
- Every number comes from an existing source: `db` getters, `resolveActivePlan`-style plan lookup, `calculateVolumeLoad`, `calculateHydrationGoal` (same goal the water logger shows), `extractExerciseHistory` + `weightPrHistory` (records). Display-only grouping lives in `utils/homeSummary.ts` so it is unit-tested; Home never recomputes 1RM or targets.
- Nothing is invented: no readiness score, no tier ladder, no fallback calorie targets. A missing target shows "No calorie goal set" with a link; no logs shows an empty state; a first-ever log is not called a record.
- "Today" uses `getCurrentDayKey()` (UTC day key), like the Workout and Nutrition screens.
- Coach Iron card only lists saved overload recommendations and links to the coach. It never calls the AI service on render.
- Body card shows weight only. Body Scan results and body-fat estimates stay on the Body screen.
- Layout: single column on phones in priority order (workout, nutrition, progress, coach, body, more); `lg` = 3-column grid with workout and progress spanning two columns and nutrition tall on the right.
- Status is always text plus an icon or label ("kcal over", "Goal reached", "Workout logged today"), never colour alone.

## Settings conventions

- Screen: `components/settings/SettingsView.tsx` owns one profile form state, the category (`SectionNav`) and the save bar. Panels are small components: `ProfilePanels.tsx` (Profile, Training, Units), `AppearancePanel.tsx`, `NotificationSettings.tsx`, `DataPanel.tsx` (+ `DataControls.tsx`), `AccountSecurity.tsx`. `ProfileOverview.tsx` sits above the nav and always shows the saved profile, never the unsaved form.
- Profile, Training and Units share one form and one Save, so edits survive switching panels. Appearance, Notifications, Data and Account act immediately (as before) and are never nested in that form.
- Unsaved changes: the save bar appears whenever the form differs from the stored profile (`isProfileDirty`), with Discard and Save changes. It is `fixed` above the mobile bottom nav and inline from `lg`; `sticky` does not work inside `<main>` because it is `overflow-x-hidden`.
- Validation (`utils/profileValidation.ts`) checks only fields the person changed, so an older profile with unusual stored values can still be saved untouched. Height keeps its own unit-aware check. A failed save jumps to the first panel with an error.
- Layout helpers: `SettingsCard` (Card + SectionHeading) and `SettingRow`/`SettingRows` (label, helper text, control; stacked on phones). Use them rather than hand-built cards.
- Destructive actions use `Modal` with a danger `Button`, and keep their confirmation steps (typed word + password for account deletion, per-category confirm for data deletion, confirm for full reset).
