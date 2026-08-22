# DESIGN.md — DataPipe design contract

Forward-looking. Not a description of what the app looks like today; the target every
design task converges on. Where this document and the code disagree, the code is wrong.
Read `PRODUCT.md` first — this exists to serve it.

**Brand constants, non-negotiable:** `brandTeal #13b24b`, `brandOrange #f78f1e`,
`brandRed #ee4523`, the dark surface `#1C1F22`, the plain jsPsych-adjacent aesthetic.
Register is *product*: earned familiarity, the tool disappears into the task.

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

**brandTeal** — the primary action color.

| Slot | Light | ratio | Dark | ratio |
|---|---|---|---|---|
| `fg` | `700 #0B7230` | 5.24 (on `bg.subtle`) | `300 #58D183` | 6.99 (on `bg.muted`) |
| `solid` | `700 #0B7230` | fill 5.64 vs page | `500 #13b24b` | fill 5.91 vs page |
| `contrast` | `white` | **6.06** on solid | `#1C1F22` | **5.91** on solid |
| `subtle` (bg) | `50 #E8F9EE` | text `800` → 8.57 | `900 #043216` | text `300` → 7.37 |
| `border` | `600 #0E923D` | 3.76 | `400 #2CC35E` | 7.15 |
| `focusRing` | `600 #0E923D` | 3.21 (worst, on `bg.muted`) | `400 #2CC35E` | 5.84 |

> `#13b24b` on white is **2.80:1**. It can never be light-mode text, and never a
> light-mode solid fill under white text. Today's `solid: brandTeal.600` + `white`
> contrast is **4.04:1 — a live AA failure in both modes.** Fix: light flips to `700`;
> dark flips the *text* to `#1C1F22` on the bright `500` fill.

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
`ok = brandTeal`, `warning = brandOrange`, `error = brandRed`, `neutral = fg.muted`
(neutral; **no blue**). `brandLime` is legacy and should be deleted once
`JsPsychIcon` is confirmed to be its only consumer.

---

## 2. Mode strategy

**Preference is three-way: `system` / `light` / `dark`.** Stored by `next-themes` in
`localStorage` under `datapipe-color-mode`, applied as a class on `<html>`
(`attribute="class"`), read by Chakra v3's `_light` / `_dark` token conditions.
`next-themes`' inline script must run before paint so there is no flash. Device-local:
no server round-trip, no Firestore field.

```jsx
// pages/_app.js
<ThemeProvider attribute="class" defaultTheme="dark"
               enableSystem={false} storageKey="datapipe-color-mode"
               disableTransitionOnChange>
  <ChakraProvider value={system}>…</ChakraProvider>
</ThemeProvider>
```

**Default: `dark`, with `enableSystem={false}`, until the conversion completes.**
Justification: roughly 40 `color="white"`, 16 `bg="greyBackground"`, 17 `whiteAlpha.*`
and 4 `bg="black"` are spread across 17 files, plus `globalCss` and `globals.css`
force the body dark unconditionally. Honoring the OS preference before those are
converted means a light-preferring researcher gets white-on-white navigation on the
page they were *blocked into* — a worse outcome than a dark theme they didn't choose.
Flip to `defaultTheme="system"` + `enableSystem` as the final step of Phase 3.

**Toggle placement:** a three-item radio group ("System / Light / Dark") inside the
existing navbar **Account menu**, above Settings. Not a floating sun/moon icon — this
is a twice-a-year tool and an unlabeled icon violates "assume no recall". Signed-out
visitors get the same control from the mobile/overflow menu.

### Migration phases

**Phase 1 — token foundation.** Diverge every `_light`/`_dark` pair in `lib/theme.js`
(today all 30+ semantic tokens set both sides identically). Delete `globalCss.body`,
`globalCss.label`, `globalCss.input`. Move `html, body` color/background out of
`globals.css` into the theme. Every new component from this point consumes semantic
tokens only.

**Phase 2 — page-by-page conversion.** Ranked by damage:

| # | File | What breaks |
|---|---|---|
| 1 | `pages/index.js` | ~53 hits: a ~40-literal syntax-highlight array, `bg="gray.950/900/800"` terminal chrome, `bg="black"` section |
| 2 | `components/Navbar.js` | 17× `color="white"`, 9× `bg="greyBackground"`, 2× `borderColor="white"`, 4× `whiteAlpha.300` |
| 3 | `pages/getting-started.js` | `bg="black"`, `color="white"`, 7× `gray.400` |
| 4 | `pages/admin/index.js` | 2× `bg="black"`, dialog `bg="greyBackground" color="white"` |
| 5 | `components/dashboard/CodeHints.js` | 4× `greyBackground`/`white`, 7× `gray.400` |
| 6 | `pages/oauth2/{connect,callback}.js` | `color="white"`, `bg="red.800"`, 3× `colorPalette="blue"` |
| 7 | `components/Footer.js` | `bg="greyBackground"`, 4× `gray.300`, `borderColor="white"` |
| 8 | `pages/admin/[experiment_id].js` | 4× `whiteAlpha.200` separators, `blue.500` link |
| 9 | `dashboard/{Title,ExperimentInfo}.js`, `admin/account.js`, `account/*` dialogs | `color="white"`, `whiteAlpha.*` separators |
| 10 | `{CodeBlock,CopyButton,SignInForm}.js`, `{signup,reset-password,api-docs}.js` | `color="white"`, `bg="gray.800"` |

Already clean, leave alone: `contact.js`, `redirect.js`, `admin/deleted-account.js`,
`dashboard/ErrorPanel.js`, `AuthCheck.js`, `Loader.js`, `TestEnvironmentWarning.js`,
`auth/AuthProviderButtons.js`, `account/OsfRelinkButton.js`. Third-party brand SVGs
keep their literal hexes — but `AuthProviderIcons.js:35` `fill="#FFF"` disappears on a
light background and needs a `currentColor` fix. `styles/Home.module.css` is imported
nowhere; delete it rather than migrate it.

**Phase 3 — ship the toggle.** Only after Phase 2 clears. Light mode must never
render a half-converted page. Then flip the default to `system`.

---

## 3. Typography

One family. Body, headings, labels, buttons and data all run on the existing system
stack (`-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, …`). **Rubik stays
logo-only** — the wordmark in `Navbar.js` and the `index.js` hero. It is not
introduced anywhere else; a display face in UI labels is a product-register ban, and
a second webfont costs a load for no legibility gain.

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

- **`brandTeal` is the primary action color, app-wide. One primary per screen.**
  Every other action on that screen is `outline` or `ghost` on `gray`.
- **`blue` is retired as an action color.** Five `colorPalette="blue"` and five raw
  `blue.500` links remain (`ProviderConnections.js:188,247`, `SelectAuth.js:120`,
  `OAuthTokenStatus.js:92`, both `oauth2/*` pages, `QueuePanel.js` status map).
  Links become `brandTeal.fg`; secondary buttons become neutral outline.
- **`brandRed` is exclusively for irreversible destruction** — account deletion,
  experiment deletion. Routine, reversible actions (disconnect a provider, unlink a
  sign-in method) are **neutral outline**. Red that means "routine" cannot also mean
  "final".
- **Status trio** `ok` / `warning` / `error` (+ `neutral`), values in §1. **Status
  is never color-alone or icon-alone: a visible text label is mandatory**, always
  rendered, never behind a tooltip or `title`. Non-text status marks still clear 3:1.
- **Focus ring:** `2px solid {colorPalette}.focusRing` with a `2px` offset, on *every*
  interactive element including icon-only and link-styled controls. Default palette
  ring is `brandTeal.focusRing` (3.21:1 worst case light, 5.84:1 dark).
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
  `colorPalette="gray"`) and is the default-focused control; the confirm button
  carries the destructive palette. The green solid "Cancel" in `DeleteAccount.js:100`
  is the exact shape this bans.

**Anticipated for the wider pass:**

- **`PageHeader`** — page title, optional one-sentence purpose line, optional back
  link. Every page gets one; `/admin/account` currently has a bare `Heading` and no
  route back to the dashboard.
- **`EmptyState`** — a heading, one sentence of what goes here and why, and the single
  primary action. Text only: no illustration, no mascot, no emoji.
- **`GuidanceLine`** — the standard help line under a section heading: `sm`/`fg.muted`,
  consequence before mechanism, with an inline link to `/getting-started` or `/faq`
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
  motion preference. Its `white` / `darkblue` borders become `border` / `brandTeal.solid`.
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
10. **Modal as first thought.** Exhaust inline and progressive disclosure first;
    dialogs are for confirming consequences, not for holding forms that fit on a page.
