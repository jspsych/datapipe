import { Box, Heading, Text } from "@chakra-ui/react";

/**
 * SettingsSection
 *
 * Replaces the `SectionLabel` eyebrow pattern that used to sit above every
 * block on `pages/admin/account.js` (five of five sections: Sign-in Methods,
 * Storage Providers, OSF (Legacy), Account, Danger Zone). That pattern —
 * `fontSize="xs"` + `fontWeight="semibold"` + `textTransform="uppercase"` +
 * `letterSpacing="wide"` + `color="gray.500"` — is flagged in
 * `.impeccable/critique/2026-08-22T13-53-28Z__pages-admin-account-js.md` as
 * both a named anti-pattern (an eyebrow above every section is scaffolding
 * by reflex) and a WCAG failure: gray.500 (#71717a) measures 3.43:1 against
 * the app's #1C1F22 surface, below the 4.5:1 AA floor for body text, and the
 * uppercase/tracked treatment makes the least legible combination available
 * even worse. Every section on that page also read as identical visual
 * weight, so "Danger Zone" was distinguished from "Sign-in Methods" by
 * nothing but the hue of a caption most people could not read.
 *
 * This component renders a REAL heading (Chakra `Heading`, `as="h2"`) in
 * sentence case, no uppercase transform, no letter-spacing trick, plus an
 * optional one-line description answering "what is this and why would I
 * care" (Design Principle 1 in PRODUCT.md: assume no recall). It owns its
 * own heading -> description -> content spacing so call sites don't have to
 * re-invent rhythm per section, and a `variant="danger"` wraps the section
 * in a bordered container so a genuinely different section ("different
 * rules apply here") reads as different, per the critique's fix for its
 * P1 "every section has identical visual weight" finding.
 *
 * Contrast (relative luminance, measured against the app body #1C1F22 --
 * see lib/theme.js for the same method):
 *   - Heading, default: color="fg" resolves to gray.50 (#fafafa) -> 15.86:1.
 *     Semantic token, not a literal step, so it tracks the light/dark theme
 *     migration automatically.
 *   - Description: color="fg.muted" resolves to gray.400 (#a1a1aa) ->
 *     6.46:1. Also semantic. NEVER use `fg.subtle` here -- that semantic
 *     token resolves to the literal gray.500 step (#71717a), which is the
 *     same 3.43:1 failure this component exists to retire.
 *   - Danger heading tint: literal `red.400` (#f87171) -> 5.99:1, clears
 *     the 4.5:1 body-text floor.
 *   - Danger border: literal `red.500` (#ef4444) -> 4.40:1 against
 *     #1C1F22, clears the 3:1 floor WCAG 1.4.11 sets for non-text UI
 *     boundaries.
 *   NOTE (dark-surface assumption): `red.400`/`red.500` above are literal
 *   Chakra palette steps, not house semantic tokens -- there is no
 *   semantic "danger"/"error" text or border token in lib/theme.js yet
 *   (only the brand palettes and the re-pointed `gray` get that
 *   treatment). Revisit these two literal references when the light/dark
 *   mode migration lands; they were chosen and measured for the current
 *   permanently-dark surface only.
 *
 * @param {string} title - Required. Rendered as an <h2>. Pass sentence
 *   case ("Storage providers", not "STORAGE PROVIDERS" or "Storage
 *   Providers").
 * @param {string} [description] - Optional single line under the heading,
 *   in plain language, explaining what the section is and why it matters.
 * @param {React.ReactNode} children - Section content.
 * @param {"default"|"danger"} [variant="default"] - "danger" wraps the
 *   section in a bordered container to signal it plays by different rules
 *   (e.g. irreversible actions). The heading stays legible either way.
 */
export default function SettingsSection({
  title,
  description,
  children,
  variant = "default",
}) {
  if (process.env.NODE_ENV !== "production" && !title) {
    console.error(
      "SettingsSection: `title` is required. A section with no heading " +
        "is exactly the illegible-eyebrow problem this component replaces."
    );
  }

  const isDanger = variant === "danger";

  const content = (
    <>
      <Heading
        as="h2"
        size="md"
        fontWeight="semibold"
        color={isDanger ? "red.400" : "fg"}
        mb={description ? 1 : 4}
      >
        {title}
      </Heading>

      {description && (
        <Text fontSize="sm" color="fg.muted" mb={4}>
          {description}
        </Text>
      )}

      {children}
    </>
  );

  if (!isDanger) {
    return <Box w="100%">{content}</Box>;
  }

  return (
    <Box
      w="100%"
      borderWidth="1px"
      borderColor="red.500"
      borderRadius="md"
      p={4}
    >
      {content}
    </Box>
  );
}
