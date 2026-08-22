// Flags gating features that are only safe to ship once specific
// preconditions in the codebase are met. Keep this file free of anything
// that isn't a literal boolean -- it exists so a flag flip is a one-line
// diff, not a refactor.

// Controls the light/dark/system color-mode control (DESIGN.md §2 "Mode
// strategy").
//
// Precondition met as of this commit: every page and component, including
// the final three (pages/getting-started.js, pages/faq.js,
// pages/api-docs.js), has been converted from raw color literals to
// semantic tokens (DESIGN.md §2 "Migration phases", Phase 2 complete). The
// deprecated brandTeal alias in lib/theme.js is deleted -- there is nothing
// left un-renamed for a light-mode visitor to land on.
//
// With this flag `true`:
//   - the "Theme" radio group (System / Light / Dark) renders in the
//     navbar Account menu (signed-in) and mobile/overflow menu
//     (signed-out), see components/ThemeSelect.js
//   - next-themes' `enableSystem` is enabled in pages/_app.js, so the OS
//     preference is honored
//   - the default theme changes from the hard-coded "dark" to "system"
//
// Rollback lever: if a conversion gap surfaces post-ship, set this back to
// `false`. That reverts to the forced-dark default and hides the toggle
// without requiring any other code change.
export const COLOR_MODE_TOGGLE = true;
