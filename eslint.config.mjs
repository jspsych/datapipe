// ESLint flat config, replacing .eslintrc.json + `next lint`.
//
// Next.js 16 removed the `next lint` command, so `npm run lint` was invoking
// `next lint`, which read "lint" as a project DIRECTORY and died with
// "Invalid project directory provided, no such directory: <repo>/lint". The
// legacy .eslintrc.json had stopped being read even before that: ESLint 9 uses
// flat config by default and only falls back to .eslintrc when
// ESLINT_USE_FLAT_CONFIG=false. So linting had been silently doing nothing.
//
// This reproduces the old config -- next/core-web-vitals, then
// eslint-config-prettier to switch off the stylistic rules Prettier owns, then
// the one project rule override -- against eslint-config-next@16's flat
// exports, which are already arrays of flat config objects.

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";

export default [
  {
    // Flat config has no .eslintignore; ignores live here. Build output and
    // vendored bundles only -- linting functions/lib would lint the compiled
    // copy of functions/src and report everything twice.
    ignores: [
      ".next/**",
      "out/**",
      "coverage/**",
      "functions/lib/**",
      "functions/metadata/dist/**",
      "**/node_modules/**",
    ],
  },
  ...nextCoreWebVitals,
  prettier,
  {
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
];
