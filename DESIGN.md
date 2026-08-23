# DESIGN.md — DataPipe design contract

Forward-looking. Not a description of what the app looks like today; the target every
design task converges on. Where this document and the code disagree, the code is wrong.
Read `PRODUCT.md` first — this exists to serve it.

**Brand constants, non-negotiable:** `brandGreen #2E7D32` (the logo's green — see
*Logo* below), `brandOrange #f78f1e`, `brandRed #ee4523`, the dark surface `#1C1F22`,
the plain jsPsych-adjacent aesthetic. Register is *product*: earned familiarity, the
tool disappears into the task.

**`brandTeal #13b24b` is retired.** It measured 1.83:1 against the logo green — close
enough to read as a mistake rather than a pairing — and 2.80:1 on white, which barred
it from light mode entirely. `#2E7D32` is 5.13:1 on white and 4.77:1 on the `#F5F7F8`
page, so adopting the logo's green is also the fix for the teal's AA failures. A
transitional `brandTeal` alias in `lib/theme.js` resolves to the brandGreen values so
un-renamed references keep rendering; it is deleted once the rename completes.

**The headline change:** DataPipe moves from a forced-dark theme to an opt-in
light/dark mode. Every color below is specified for both modes with a computed WCAG 2.1
ratio. Body text ≥4.5:1, large text and non-text UI boundaries ≥3:1 — **in both
modes**, against the *worst* surface the token is allowed to sit on.

---

## 1. Theme architecture

Neutral ramp stays Chakra v3's default `gray` (zinc: `200 #e4e4e7`, `300 #d4d4d8`,
`400 #a1a1aa`, `500 #71717a`, `600 #52525b`, `700 #3f3f46`, `800 #27272a`). The dark
column is the measured work already in `lib/theme.js`, corrected where it failed.

**Light surface direction:** a cool, near-neutral off-white — *not* the cream /
warm-sand body that reads as 2026 AI-default. Page `#F5F7F8` carries a 3-point
channel spread toward the same cool slate hue as `#1C1F22`; panels are true white.
Light-mode ink is `#1C1F22` itself: the dark surface color becomes the light text
color, so the brand's one distinctive neutral is present in both modes.

### Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F5F7F8` | `#1C1F22` | Page body |
| `bg.subtle` | `#EBEFF1` | `#16191B` | Recessed: code blocks, table headers |
| `bg.panel` | `#FFFFFF` | `#1C1F22` | Cards, dialogs, menus. Dark stays flat — delineated by `border`, not elevation |
| `bg.muted` | `#E1E6E9` | `#2A2F34` | Hover / selected fills |

Page↔panel separation is 1.07:1 in both modes. That is intentional and it means
**panels must carry a `border`** — never rely on the fill alone to define an edge.

### Foreground (all three levels clear 4.5:1 on every surface above)

| Token | Light | Dark | Worst-case ratio (light / dark) |
|---|---|---|---|
| `fg` | `#1C1F22` | `gray.50 #fafafa` | 13.16 / 12.94 (on `bg.muted`) |
| `fg.muted` | `gray.700 #3f3f46` | `gray.300 #d4d4d8` | 8.30 / 9.14 (on `bg.muted`) |
| `fg.subtle` | `gray.600 #52525b` | `gray.400 #a1a1aa` | 6.15 / 5.27 (on `bg.muted`) |

`gray.500` is **retired as a text color.** It measures 3.43:1 on `#1C1F22` and is the
source of the account page's `SectionLabel` and "use personal access token" failures.
It survives as a border value only.

### Borders

| Token | Light | Dark | Ratio vs `bg` | Use |
|---|---|---|---|---|
| `border` | `gray.500 #71717a` | `gray.500 #71717a` | 4.50 / 3.43 | Inputs, outline buttons, panel edges, table rules — anything WCAG 1.4.11 covers |
| `border.subtle` | `gray.300 #d4d4d8` | `#3F4449` | 1.38 / 1.68 | Decorative hairlines *inside* an already-grouped region. Never the only grouping device |

One value serves both modes. `whiteAlpha.200` (1.92:1) is **banned**.

### Palettes

Each `colorPalette` supplies `fg` (text on `bg`/`bg.panel`), `subtle`+`muted` (tinted
fills), `solid`+`contrast` (filled controls), `border`, `focusRing`.

**brandGreen** — the primary action color. The ramp is **Material Green verbatim**
(`50 #E8F5E9`, `100 #C8E6C9`, `200 #A5D6A7`, `300 #81C784`, `400 #66BB6A`,
`500 #4CAF50`, `600 #43A047`, `700 #388E3C`, `800 #2E7D32`, `900 #1B5E20`), because
the logo green `#2E7D32` *is* Material Green 800 and the logo's own token sheet names
`#43A047` (600) as its mid step. The brand color sits on the ramp rather than near it,
and every step is a hand-tuned tone instead of an interpolation off one hex.

| Slot | Light | ratio | Dark | ratio |
|---|---|---|---|---|
| `fg` | `800 #2E7D32` | 4.77 (on `bg`; 5.13 on `bg.panel`) | `300 #81C784` | 6.71 (on `bg.muted`) |
| `solid` | `800 #2E7D32` | fill 4.77 vs page | `500 #4CAF50` | fill 5.96 vs page |
| `contrast` | `white` | **5.13** on solid | `#1C1F22` | **5.96** on solid |
| `subtle` (bg) | `50 #E8F5E9` | text `900` → 7.00 | `900 #1B5E20` | text `50` → 7.00 |
| `border` | `700 #388E3C` | 3.83 | `400 #66BB6A` | 7.00 |
| `focusRing` | `700 #388E3C` | 3.27 (worst, on `bg.muted`) | `400 #66BB6A` | 5.71 (worst, on `bg.muted`) |

Palette `fg` is text on `bg` / `bg.panel` only. On the light tinted neutrals it drops
to 4.43 (`bg.subtle`) and 4.08 (`bg.muted`), so a green label inside a recessed or
hover-filled region uses `fg` (the neutral), not `brandGreen.fg`.

> **Superseded — the teal fix below is now moot; the green replaces it.** `#13b24b` on
> white was **2.80:1**: it could never be light-mode text, and never a light-mode solid
> fill under white text, and `solid: brandTeal.600` + `white` was **4.04:1 — a live AA
> failure in both modes.** The teal fix was to flip light to `700` and flip dark's
> *text* to `#1C1F22` on the bright `500` fill. Adopting the logo green retires the
> problem at its source instead: `#2E7D32` clears 4.5:1 on both light surfaces, so
> light-mode green text and a white-on-green solid are both legal for the first time.
> The dark-side flip survives on its merits — computed both ways on `#1C1F22`, a dark
> fill under white text (`800` + `white`) gives fill 3.23 / text 5.13, while the bright
> fill under dark text (`500` + `#1C1F22`) gives fill 5.96 / text 5.96, better on both
> axes. On a dark page a dark green button is a hole; the bright chip reads as a control.

> **Caveat on `subtle`.** Chakra's `subtle` and `surface` variants paint
> `colorPalette.fg` on `colorPalette.subtle`, and in dark mode that pairing is
> `300` on `900` = **3.91:1**, under the body floor. Material Green 900 is a mid-dark
> green, not the near-black the hand-tuned teal 900 was, and the ramp has nothing
> darker. Text on `brandGreen.subtle` is therefore named explicitly (`50`, above), and
> `variant="subtle"` / `variant="surface"` on `brandGreen` is **not approved for body
> text** until a semantic pairing token exists. No call site uses either variant on
> this palette today.

**brandOrange** — warning / attention only.

| Slot | Light | ratio | Dark | ratio |
|---|---|---|---|---|
| `fg` | `800 #7C4606` | 6.63 | `300 #FFB74D` | 7.80 |
| `subtle` (bg) | `50 #FFF3E0` | text `800` → 7.00 | `900 #3E2303` | text `gray.200` → 11.44 |
| `border` | `700 #A85F08` | 4.54 | `400 #FFA726` | 8.52 |

**`brandOrange` has no `solid`.** Every orange dark enough to hold white text
(`700` = 4.88) has stopped being the brand orange. Orange is a status hue, never a
button fill.

**brandRed** — irreversible destruction only.

| Slot | Light | ratio | Dark | ratio |
|---|---|---|---|---|
| `fg` | `700 #A82E16` | 5.92 | `300 #F17761` | 4.86 (on `bg.muted`) |
| `solid` | `700 #A82E16` | fill 6.37 | `600 #D13A1B` | fill 3.42 |
| `contrast` | `white` | 6.85 | `white` | 4.85 |
| `subtle` (bg) | `50 #FDE8E4` | text `800` → 8.30 | `900 #4A1509` | text `gray.200` → 11.80 |
| `border` | `600 #D13A1B` | 4.51 | `400 #EF5A3E` | 4.89 |

**gray** — neutral controls (the default `colorPalette`).

| Slot | Light | Dark |
|---|---|---|
| `fg` | `800 #27272a` (13.86) | `200 #e4e4e7` (13.05) |
| `solid` / `contrast` | `800` / `gray.50` → 14.27 | `200` / `gray.900` → 13.96 |
| `subtle` / `muted` / `emphasized` | `100` / `200` / `300` | `800` / `700` / `600` |
| `border` | `500` (4.50) | `500` (3.43) |

**Status** aliases onto the brand hues — one green, not two:
`ok = brandGreen`, `warning = brandOrange`, `error = brandRed`, `neutral = fg.muted`
(neutral; **no blue**). `brandLime` is legacy and should be deleted once
`JsPsychIcon` is confirmed to be its only consumer.

### Logo

The mark (`docs/brand/logo/README.md`) is the source of the brand green and is
authoritative over the ramp, not the other way round.

| Role | Value | Where |
|---|---|---|
| Bar + chevron 1, light bg | `#2E7D32` | = `brandGreen.800`. The anchor |
| Bar + chevron 1, dark bg | `#F2F5F1` | 15.06 on `#1C1F22`. Not `fg` — the mark keeps its own paper white |
| Chevron 2 (echo) | `#8BC34A` | **Mark only.** Identical in both modes by design |

**The navbar renders on the dark ground only** (light mode is retired, §2). The bar
keeps its `bg` + `border`-bottom semantics and the mark/wordmark render via
`logo.mark`, resolving to `#F2F5F1` — the mark's own paper white, deliberately not
`fg`. The logo handoff still specifies both grounds; the light-bg values document
the mark itself (README badges, external use), not any shipped surface.

**Mode-invariant `code.*` tokens** carry the code-specimen "device" (landing terminal
mock, `CodeBlock`, `CodeHints`): `code.bg = gray.950 #111111` (17.57:1 against the
light page — a deliberate object), `code.bg.header`, `code.bg.active`, `code.border =
gray.500` (the seam: 4.50 light / 3.43 dark, one value both modes), `code.border.subtle`,
`code.fg 12.78:1`, `code.fg.strong`, `code.fg.muted 7.37:1`, `code.comment`,
`code.string 10.91:1`, `code.fn 9.38:1`. `_light` and `_dark` are identical *on
purpose*; the invariance is the design.

**`status.*` aliases** exist as tokens (`status.ok/warning/error/neutral`) mirroring
each palette's `fg` slot in both modes — components never hand-pick status hues.

**The echo green `#8BC34A` is never a UI color.** It is 2.10:1 on white and off the
Material Green ramp entirely — it exists because it is the one tone that holds against
both `#FFFFFF` and the logo's `#101A14`, inside a mark where it carries no meaning on
its own. It is never text, never a fill, never a border, never a status hue.

---

## 2. Mode strategy

**Dark is the product's only mode** (owner decision, 2026-08-23). A three-way
System/Light/Dark control shipped briefly once the token migration completed, and
was retired: the light rendering never looked right, and a twice-a-year control was
not worth carrying UI surface and a second design target for every future change.
`pages/_app.js` pins `forcedTheme="dark"` — forced, not merely defaulted, so a
Light/System preference stored in `localStorage` while the toggle existed cannot
resurrect the retired mode. `components/ThemeSelect.js` and the `COLOR_MODE_TOGGLE`
flag (`lib/feature-flags.js`) are deleted; `git log` has the full migration history
if the decision is ever revisited.

**What survives the retirement.** The token conversion the toggle motivated is kept
and remains mandatory: every component consumes semantic tokens (`fg`, `bg.panel`,
`brandOrange.subtle`, …), never raw color literals. The `_light` branches in
`lib/theme.js` are inert under forced dark and stay in place — they cost nothing,
keep Chakra's token shape idiomatic, and are the escape hatch if this is revisited.
Judge every new color choice against the dark surfaces only.

---

## 3. Typography

One family for UI. Body, headings, labels, buttons and data all run on the existing
system stack (`-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, …`). **Rubik is
retired entirely.** The wordmark is **Space Grotesk, lockup-only** — the `LogoMark` +
wordmark pairing in `Navbar.js` (600 / 22px / -0.03em), owner-ratified with the |>
logo adoption. It appears nowhere else: not in headings, not in the hero, not in
labels — a display face in UI text is a product-register ban, and the single webfont
load is spent on the brand lockup alone.

Fixed rem scale, tight ratio, four roles:

| Role | Size / weight | Color | Notes |
|---|---|---|---|
| Page title | `2xl` (24px) / 700 | `fg` | One per page. Sentence case |
| Section heading | `lg` (18px) / 600 | `fg` | A real `<Heading as="h2">`, sentence case |
| Body | `md` (16px) / 400 | `fg` | Default. Prose measure 65–75ch |
| Supporting | `sm` (14px) / 400 | `fg.muted` | Descriptions, hints, help lines |
| Fine print | `xs` (12px) / 400 | `fg.muted` | Timestamps, IDs. **Never** `fg.subtle` at this size |

**Sentence case everywhere**, including buttons. `textTransform="uppercase"` +
`letterSpacing="wide"` micro-labels are banned — see §8. Today's codebase is
`fontSize="sm"` 74×, `xs` 19×: a page whose default text is 14px is a page with no
body size. Let 16px be the default and reserve `sm` for genuinely secondary text.

---

## 4. Spacing & layout rhythm

- **Settings / single-subject content column: `maxW="560px"`.** Confirmed keep — a
  correct, confident measure for a scanned page. Dashboard and marketing pages use
  `maxW="1100px"`; consolidate the stray `540px` / `960px` / `440px` onto these two.
- Spacing scale: Chakra's 4px base. Use `2 / 3 / 4 / 6 / 8 / 12 / 16` and nothing
  else. Within a row: `gap={3}`. Within a section: `gap={4}`. Between routine
  sections: `mt={10}`. Before a consequential section (Danger Zone, anything
  destructive): `mt={16}`.
- **Spacing carries grouping.** More air means "different subject, higher stakes."
  A page whose sections are all `my={6}` apart is telling the reader nothing.

**Separator policy — committed:** *spacing-only grouping between sections.* Remove
every `<Separator>` from `pages/admin/account.js` (4×) and
`pages/admin/[experiment_id].js` (4×). A hairline at 1.27:1 is not a weak separator,
it is an absent one, and raising it to a visible 3:1 rule between five sections makes
a settings page look like a spreadsheet. Separators survive only *inside* dense
repeating structures — table row rules, menu group dividers — where they use `border`
or `border.subtle` and are not the primary grouping device. Grouping that spacing
cannot carry alone gets a bordered container (see `SettingsSection` danger variant).

---

## 5. Color semantics

- **`brandGreen` is the primary action color, app-wide. One primary per screen.**
  Every other action on that screen is `outline` or `ghost` on `gray`.
- **`blue` is retired as an action color.** Five `colorPalette="blue"` and five raw
  `blue.500` links remain (`ProviderConnections.js:188,247`, `SelectAuth.js:120`,
  `OAuthTokenStatus.js:92`, both `oauth2/*` pages, `QueuePanel.js` status map).
  Links become `brandGreen.fg` **with a persistent underline** — no green/body text
  pair reaches the 3:1 color-difference floor in either mode (2.04 light / 1.36 dark),
  so color alone can never mark a link. `globals.css` strips the default underline;
  every prose link sets it back explicitly.
  Secondary buttons become neutral outline.
- **`brandRed` is exclusively for irreversible destruction** — account deletion,
  experiment deletion. Routine, reversible actions (disconnect a provider, unlink a
  sign-in method) are **neutral outline**. Red that means "routine" cannot also mean
  "final".
- **Status trio** `ok` / `warning` / `error` (+ `neutral`), values in §1. **Status
  is never color-alone or icon-alone: a visible text label is mandatory**, always
  rendered, never behind a tooltip or `title`. Non-text status marks still clear 3:1.
- **Focus ring:** `2px solid {colorPalette}.focusRing` with a `2px` offset, on *every*
  interactive element including icon-only and link-styled controls. Default palette
  ring is `brandGreen.focusRing` (3.27:1 worst case light, 5.71:1 dark).
  `focusRing="none"` — currently on four `Navbar` links — is banned.
- **Semantic z-index scale.** `globals.css:54` has the app's only z-index, an
  arbitrary `1000`. Replace with theme tokens and use nothing else:

  | Token | Value | Use |
  |---|---|---|
  | `docked` | 10 | Sticky table headers |
  | `dropdown` | 1000 | Menus, popovers, selects |
  | `sticky` | 1100 | Sticky page chrome |
  | `banner` | 1200 | `.sticky-alert` / `TestEnvironmentWarning` |
  | `modal.backdrop` | 1300 | Dialog backdrop |
  | `modal` | 1400 | Dialog content |
  | `toast` | 1500 | Transient notifications |
  | `tooltip` | 1600 | Tooltips (decoration only — never meaning) |

---

## 6. Component inventory

Shared primitives live in `components/ui/`. Every interactive one ships all seven
states — default, hover, focus, active, disabled, loading, error — or it does not
ship.

**Being built now:**

- **`SettingsSection`** — a real `<h2>` (`lg`/600/`fg`), optional one-line description
  in `sm`/`fg.muted` that says what the section is and what depends on it, and the
  section body. `variant="danger"` wraps the body in a `1px border.brandRed` container
  with `p={5}` and `rounded="md"`. Replaces `SectionLabel` entirely.
- **`StatusIndicator`** — `status` (`ok`/`warning`/`error`/`neutral`) plus a
  **mandatory visible `label`**. Icon + text, always both, always rendered. No tooltip
  variant exists, so `OAuthTokenStatus`'s hover-only state cannot be reproduced.
  Replaces all three of the account page's competing status renderings.
- **`FormErrorAlert`** — the single form-error surface. Takes a human message (mapped
  through `lib/auth-errors.js`, never a raw Firebase code), renders on
  `brandRed.subtle` with `brandRed.fg` text and `role="alert"`. One pattern for the
  three error paths that currently disagree.
- **`ConfirmDialog`** — async `onConfirm` with a loading state on the confirm button;
  failures are caught and surfaced **inside the dialog via `FormErrorAlert`**, and the
  dialog stays open. **Cancel is always neutral** (`variant="outline"`,
  `colorPalette="gray"`) and is the default-focused control; the confirm button carries
  `brandRed` when `destructive`, `brandGreen` — the primary — otherwise. The green solid
  "Cancel" in `DeleteAccount.js:100` is the exact shape this bans.

**Anticipated for the wider pass:**

- **`PageHeader`** — page title, optional one-sentence purpose line, optional back
  link. Every page gets one; `/admin/account` currently has a bare `Heading` and no
  route back to the dashboard.
- **`EmptyState`** — a heading, one sentence of what goes here and why, and the single
  primary action. Text only: no illustration, no mascot, no emoji.
- **`GuidanceLine`** — the standard help line under a section heading: `sm`/`fg.muted`,
  consequence before mechanism, with an inline link to `/getting-started` or `/docs`
  where one exists. Shown at zero-state as well as one-state.

---

## 7. Motion

Minimal and purposeful. Motion conveys state change, feedback, loading, or reveal —
nothing else. No scroll-jacking, no parallax, no bounce or spring easing, no
orchestrated page-load sequences.

- Duration `150–200ms`; easing `ease-out` only (`cubic-bezier(0, 0, 0.2, 1)`).
- Color-mode switches do **not** animate (`disableTransitionOnChange`).
- **Every animation needs a `prefers-reduced-motion` story.** The `.loader` spinner
  (`globals.css:26–42`) has none. Its fallback: under
  `@media (prefers-reduced-motion: reduce)` drop the `spin` animation, leaving a static
  ring plus a visible `aria-live` "Loading…" label — the label is required regardless of
  motion preference. Its `white` / `darkblue` borders become `border.subtle` (track) /
  `brandGreen.solid` (arc) — the arc-vs-track pair computes 3.47:1 light / 3.54:1 dark;
  a `border` track would sit at 1.06:1 against the light arc and the ring would appear
  static.
- Skeletons over centered spinners for content loading in place; spinners are for
  actions, not regions.

---

## 8. Anti-patterns — codebase-specific bans

1. **Uppercase tracked eyebrow micro-labels.** `pages/admin/account.js:21–34`
   `SectionLabel` renders five of them at `xs` + `uppercase` + `letterSpacing="wide"`
   + `gray.500` (3.43:1) — the least legible configuration available, and an eyebrow on
   every section is scaffolding by reflex. Real headings, sentence case.
2. **Icon-only or color-only status.** `OAuthTokenStatus` hides its state behind a
   hover tooltip: unreachable on touch, unreliable by keyboard, unannounced.
3. **Meaning in `title=` or a tooltip on a disabled control.**
   `LinkedAccounts.js:129` explains why unlinking is blocked in a `title` attribute on
   a disabled button. The explanation goes in visible text next to the control.
4. **Green / primary-solid cancel buttons.** `DeleteAccount.js:100`. Cancel is neutral;
   the loud button is never the safe one.
5. **Raw hex or raw palette steps in components.** `color="white"`,
   `bg="greyBackground"`, `bg="black"`, `whiteAlpha.*`, `gray.400`, `blue.500` — tokens
   only. Third-party brand SVGs are the sole exception.
6. **Arbitrary z-index values.** `globals.css:54` `z-index: 1000`. Use the §5 scale.
7. **Silent catch blocks that swallow user-facing failures.** `handleConnect` and
   `handleDisconnect` in `ProviderConnections.js` end in `console.error` with nothing
   rendered; `ChangePassword` discards `auth/requires-recent-login` and shows the word
   "Failed". PRODUCT.md principle 5 is "no silent failures" — every failed action
   surfaces a mapped, human message through `FormErrorAlert`.
8. **`focusRing="none"`.** Four instances in `Navbar.js`. Keyboard operability is not
   optional.
9. **Validation errors before first input.** Gate on touched/dirty, not on value.
11. **Marketing copy that describes a retired product.** The landing page (and any
    public surface) must describe what `lib/provider-config.js` actually ships. When
    providers change, the landing copy converts in the same slice — stale "OSF"
    claims on the trust-deciding surface are a P0, not a copy nit.
10. **Modal as first thought.** Exhaust inline and progressive disclosure first;
    dialogs are for confirming consequences, not for holding forms that fit on a page.
