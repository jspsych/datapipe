// jest.config.js
const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
/** @type {import('jest').Config} */
const customJestConfig = {
  // Add more setup options before each test is run
  setupFiles: ['<rootDir>/jest.setup.js'],
  // if using TypeScript with a baseUrl set to the root directory then you need the below for alias' to work
  moduleDirectories: ['node_modules', '<rootDir>/'],
  testEnvironment: 'jest-environment-jsdom',
  // Scratch directories that hold a full copy of the repo. `.claude/worktrees/`
  // is where agent worktrees land; each one carries its own
  // functions/metadata/package.json, and Jest's haste map refuses to resolve
  // `@jspsych/metadata` when two packages claim the name -- every suite that
  // imports it dies with "looked up in the Haste module map". `.firebase/` is
  // the deploy staging copy and collides the same way on the root package
  // name. Neither is a test root, and neither exists in CI (both untracked),
  // so this only shows up locally -- which is exactly why it is worth pinning
  // here rather than rediscovering it each time.
  modulePathIgnorePatterns: ['<rootDir>/.claude/', '<rootDir>/.firebase/'],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
//
// The async wrapper exists because of `jose`. firebase-admin v14 pulls in
// jwks-rsa 4.x, which depends on jose 6.x -- an ESM-only package with no
// `require` condition in its exports map. Jest loads test modules as CJS and
// leaves node_modules untransformed, so every suite that reaches
// firebase-admin/auth dies on "Cannot use import statement outside a module".
// Production is unaffected: functions/ is "type": "module" running on Node 22.
//
// next/jest builds its own transformIgnorePatterns, and Jest skips a file if
// ANY pattern matches -- so appending a permissive pattern of our own does
// nothing, next's still matches. The patterns have to be widened in place.
// Injecting into next's existing allowlist group (rather than replacing the
// array wholesale) keeps its geist / next-internals / pnpm handling intact.
// If next ever changes the shape of that group the replace becomes a no-op,
// so fail loudly here rather than let the jose suites break confusingly.
module.exports = async () => {
  const config = await createJestConfig(customJestConfig)()
  const ALLOWLIST_GROUP = '(?!(geist|'
  let widened = false
  config.transformIgnorePatterns = config.transformIgnorePatterns.map((pattern) => {
    if (!pattern.includes(ALLOWLIST_GROUP)) return pattern
    widened = true
    return pattern.replace(ALLOWLIST_GROUP, '(?!(jose|geist|')
  })
  if (!widened) {
    throw new Error(
      "jest.config.js: could not widen next/jest's transformIgnorePatterns to " +
        'include jose. next/jest changed its pattern shape -- see the comment above.'
    )
  }
  return config
}