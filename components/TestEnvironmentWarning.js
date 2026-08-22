export default function TestEnvironmentWarning() {
  const env = process.env.NEXT_PUBLIC_OSF_ENV;

  // Defense in depth. pages/_app.js already gates whether this component
  // mounts at all on a truthy NEXT_PUBLIC_OSF_ENV -- the old guard was
  // `!== ""`, which renders when the var is UNDEFINED (`undefined !== ""` is
  // true), so an unset var in a deploy would have shipped this banner to
  // production. That guard is fixed alongside this file. This second check
  // means the component is also safe to mount unconditionally from any
  // future call site.
  if (!env) {
    return null;
  }

  return (
    // `.sticky-alert` (styles/globals.css) supplies position/z-index --
    // fixed to the viewport bottom at the `banner` z-index token. Out of
    // this file's ownership, already correct, left untouched.
    <div className="sticky-alert" role="status">
      <div
        className="sticky-alert__content"
        style={{
          // A warning, not a destructive/error state, so brandOrange per
          // DESIGN.md §1 status trio -- brandRed is reserved for
          // irreversible destruction and would misstate the stakes here.
          // Overridden inline (globals.css's `.sticky-alert__content` rule
          // is out of this file's ownership) with the brandOrange.subtle /
          // brandOrange.fg pair: computed 7.00:1 light (brandOrange.50 +
          // brandOrange.800, exactly DESIGN.md's cited pairing), 8.39:1 dark
          // (brandOrange.900 + brandOrange.300, computed directly -- higher
          // than the 4.5:1 body floor even though it's not the alternate
          // gray.200-on-900 pairing DESIGN.md cites at 11.44:1).
          background: "var(--chakra-colors-brand-orange-subtle)",
          color: "var(--chakra-colors-brand-orange-fg)",
        }}
      >
        Test environment ({env}). Data sent here is not preserved. Do not
        sign in with production credentials.
      </div>
    </div>
  );
}
