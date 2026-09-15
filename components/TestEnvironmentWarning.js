import { useEffect, useRef } from "react";

export default function TestEnvironmentWarning() {
  const env = process.env.NEXT_PUBLIC_DEPLOY_ENV;
  const contentRef = useRef(null);

  // Truthy AND not "production": NEXT_PUBLIC_DEPLOY_ENV is unset (falsy) in
  // production deploys, but a belt-and-suspenders `!== "production"` check
  // means a future deploy that accidentally sets it to something truthy in
  // prod still doesn't ship this banner there.
  const show = !!env && env !== "production";

  // Defense in depth. pages/_app.js already gates whether this component
  // mounts at all on the same condition -- this second check means the
  // component is also safe to mount unconditionally from any future call
  // site (pages/index.js and components/docs/DocsLayout.js each render
  // their own copy of this gate today; see the parent task notes).
  useEffect(() => {
    if (!show) {
      return;
    }

    const node = contentRef.current;
    if (!node) {
      return;
    }

    // Reserve the banner's own rendered height at the bottom of the
    // document so `.sticky-alert` (styles/globals.css), which is
    // position:fixed to the viewport bottom, never covers the last row of
    // whatever is actually at the bottom of the page (Footer, in
    // practice). Measured live via ResizeObserver rather than a fixed
    // guess: the copy below wraps to 2-3 lines on narrow viewports, so a
    // single magic-number padding would either undershoot on mobile or
    // over-reserve on desktop. Cleared on unmount so nothing is reserved
    // once the banner stops being mounted.
    const observer = new ResizeObserver(() => {
      document.body.style.paddingBottom = `${node.getBoundingClientRect().height}px`;
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
      document.body.style.paddingBottom = "";
    };
  }, [show]);

  if (!show) {
    return null;
  }

  return (
    // `.sticky-alert` (styles/globals.css) supplies position/z-index --
    // fixed to the viewport bottom at the `banner` z-index token. Out of
    // this file's ownership, already correct, left untouched.
    <div className="sticky-alert" role="status">
      <div
        ref={contentRef}
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
        Test environment. Data sent here is not preserved. Do not sign in
        with production credentials.
      </div>
    </div>
  );
}
