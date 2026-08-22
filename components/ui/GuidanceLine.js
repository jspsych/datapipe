import { Text, Link as ChakraLink } from "@chakra-ui/react";
import NextLink from "next/link";

/**
 * GuidanceLine
 *
 * The standard help line under a section heading, and the one styling of a
 * help line in the app. DESIGN.md §6 ("anticipated") names it; the dashboard
 * critique's §7 recommends it be the renderer `SettingsSection` uses for its
 * `description`, so there is a single treatment usable standalone wherever a
 * line of guidance is needed without a section wrapper.
 *
 * Voice rules this component exists to make cheap (PRODUCT.md Principle 2,
 * "consequence before mechanism"): say what happens to the researcher's data
 * first, name the machinery second, and link to /getting-started or /faq when
 * there is somewhere to send them. Shown at zero-state as well as one-state --
 * the six-month researcher needs it more than the first-timer does.
 *
 * Typography per DESIGN.md §3 "Supporting": `sm` (14px) / 400 / `fg.muted`.
 * `fg.muted` measures 8.30:1 light (gray.700 on bg.muted, the worst permitted
 * surface) and 9.14:1 dark (gray.300), both far above the 4.5:1 body floor.
 * Never `fg.subtle` here, and never below `sm` -- that pairing is the 3.43:1
 * eyebrow failure this whole pass is retiring.
 *
 * The inline link renders `brandGreen.fg` (#2E7D32 light, 4.77:1 on `bg` /
 * 5.13:1 on `bg.panel`; #81C784 dark, 6.71:1 worst case on `bg.muted`), which
 * is DESIGN.md §5's ruling that links are green now -- blue is retired as an
 * action color. It carries an underline as well as the hue, so the link is not
 * signalled by color alone.
 *
 * @param {React.ReactNode} children - The guidance sentence(s).
 * @param {string} [href] - Optional destination for a trailing inline link.
 * @param {string} [linkText] - Link text. Required when `href` is set.
 * @param {boolean} [external=false] - Route through a plain anchor with
 *   `rel="noopener noreferrer"` and `target="_blank"` instead of next/link.
 * @param {number} [mb] - Optional bottom margin, for call sites that own their
 *   own rhythm (SettingsSection sets this).
 */
export default function GuidanceLine({
  children,
  href,
  linkText,
  external = false,
  ...rest
}) {
  if (process.env.NODE_ENV !== "production" && href && !linkText) {
    console.error(
      "GuidanceLine: `linkText` is required when `href` is set. A bare URL " +
        "is not a description of where it goes."
    );
  }

  const link = href ? (
    external ? (
      <ChakraLink
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        color="brandGreen.fg"
        textDecoration="underline"
      >
        {linkText}
      </ChakraLink>
    ) : (
      <ChakraLink asChild color="brandGreen.fg" textDecoration="underline">
        <NextLink href={href}>{linkText}</NextLink>
      </ChakraLink>
    )
  ) : null;

  return (
    <Text fontSize="sm" color="fg.muted" maxW="70ch" {...rest}>
      {children}
      {link && <> {link}</>}
    </Text>
  );
}
