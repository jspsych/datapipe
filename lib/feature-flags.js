// Flags gating features that are only safe to ship once specific
// preconditions in the codebase are met. Keep this file free of anything
// that isn't a literal boolean -- it exists so a flag flip is a one-line
// diff, not a refactor.

// Controls the light/dark/system color-mode control (DESIGN.md §2 "Mode
// strategy"). Flipping this to `true`:
//   - renders the "Theme" radio group (System / Light / Dark) in the
//     navbar Account menu (signed-in) and mobile/overflow menu
//     (signed-out), see components/ThemeSelect.js
//   - enables next-themes' `enableSystem` in pages/_app.js, so the OS
//     preference is honored
//   - changes the default theme from the hard-coded "dark" to "system"
//
// Precondition: pages/getting-started.js, pages/faq.js and
// pages/api-docs.js must be converted to semantic tokens first (DESIGN.md
// §2 "Migration phases", Phase 2 items #3, #10). Until then those pages
// still carry literal `color="white"` / `bg="black"` etc., so a
// light-preferring visitor who reaches them via `system` or an explicit
// `light` selection would get a half-converted, unreadable page --
// "Light mode must never render a half-converted page."
export const COLOR_MODE_TOGGLE = false;
