import { HStack, Text } from "@chakra-ui/react";
import { CircleCheck, TriangleAlert, CircleX, Minus } from "lucide-react";

/**
 * StatusIndicator
 *
 * One way to render status, replacing three divergent patterns that grew up
 * independently on `pages/admin/account.js`:
 *   - `ProviderConnections.js`: icon + visible text ("Connected") -- the one
 *     that already got this right.
 *   - `OAuthTokenStatus.js`: icon-only, with the status word ("Connected" /
 *     "Re-authentication Required") living inside a `Tooltip` that only
 *     opens on hover -- inaccessible on touch and to keyboard users, and a
 *     color/icon-alone signal until the tooltip is triggered.
 *   - `LinkedAccounts.js`: a plain gray `Badge` ("Enabled") with no icon and
 *     no relation to the other two.
 * `.impeccable/critique/2026-08-22T13-53-28Z__pages-admin-account-js.md`
 * calls this out directly under "Status renders three ways" (P2) and
 * Recognition Rather Than Recall (score 2): "OSF connection status is
 * icon-only with the text behind hover." PRODUCT.md's Accessibility section
 * is explicit that status must never be conveyed by color or icon alone.
 *
 * This component makes the label mandatory and ALWAYS visible as text next
 * to the icon -- never behind a tooltip, never color-only. In development,
 * a missing label is a console error rather than a silent render, so the
 * anti-pattern this replaces can't quietly come back through a call site
 * that forgets the prop.
 *
 * The icon is `aria-hidden` and decorative; the visible label text is what
 * carries the meaning to assistive tech, so no `role="status"` is applied
 * here -- this renders a static, already-known state (e.g. "Connected" on
 * a settled page), not a live region announcing a change as it happens. A
 * call site that needs an announcement should wrap this in its own live
 * region at the point the status actually changes.
 *
 * Contrast (measured against the app body #1C1F22, same method as
 * lib/theme.js):
 *   - ok / CircleCheck: literal `brandGreen.500` (#4CAF50) -> 5.96:1. NOT
 *     Chakra's `green.500`: DESIGN.md §1 commits to one green ("ok" IS the
 *     brand green), and giving this primitive a second green at birth would
 *     re-create the two-greens drift it exists to end. This was the retired
 *     `brandTeal.500` (#13b24b, 5.91:1) until the logo green #2E7D32 became
 *     the primary; the ramp is Material Green, so `ok` moved with it.
 *   - warning / TriangleAlert: literal `orange.500` (#f97316) -> 5.91:1.
 *   - error / CircleX: literal `red.400` (#f87171) -> 5.99:1.
 *   - neutral / Minus: literal `gray.400` (#a1a1aa) -> 6.46:1.
 *   All four clear the 3:1 floor WCAG 1.4.11 sets for non-text UI (icons
 *   count as non-text), with headroom to spare.
 *   NOTE (dark-surface assumption): all four are literal Chakra palette
 *   steps passed as raw CSS color strings to lucide-react's `color` prop
 *   (lucide icons are not Chakra-token-aware), because lib/theme.js has no
 *   semantic success/warning/error/neutral color tokens yet -- only the
 *   brand palettes and the re-pointed `gray` get semantic treatment. These
 *   were chosen and measured for the current permanently-dark surface;
 *   revisit when the light/dark mode migration adds semantic status
 *   tokens.
 *   - Label: `color="fg"` (semantic, gray.50 / #fafafa) -> 15.86:1, well
 *     above the 4.5:1 body-text floor. Semantic, so it tracks the
 *     light/dark migration automatically.
 *
 * @param {"ok"|"warning"|"error"|"neutral"} status
 * @param {string} label - REQUIRED. Always rendered as visible text beside
 *   the icon -- this is the one place status is stated in words, not
 *   inferred from color or shape.
 * @param {number} [size=16] - Icon size in px (~16-18 recommended).
 */

const STATUS_ICONS = {
  ok: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
  neutral: Minus,
};

// Raw CSS color strings (Chakra's generated custom properties), not Chakra
// style props -- lucide-react's `color` prop is not token-aware, so this is
// the same `var(--chakra-colors-...)` pattern already used for icon color
// elsewhere in the app (see components/account/ProviderConnections.js).
const STATUS_COLORS = {
  ok: "var(--chakra-colors-brand-green-500)",
  warning: "var(--chakra-colors-orange-500)",
  error: "var(--chakra-colors-red-400)",
  neutral: "var(--chakra-colors-gray-400)",
};

export default function StatusIndicator({ status, label, size = 16 }) {
  if (process.env.NODE_ENV !== "production" && !label) {
    console.error(
      "StatusIndicator: `label` is required. Status must never be " +
        "conveyed by color or icon alone -- see PRODUCT.md Accessibility " +
        "& Inclusion."
    );
  }

  const Icon = STATUS_ICONS[status] || STATUS_ICONS.neutral;
  const color = STATUS_COLORS[status] || STATUS_COLORS.neutral;

  return (
    <HStack gap={1.5} display="inline-flex" alignItems="center">
      <Icon aria-hidden="true" size={size} color={color} />
      <Text fontSize="sm" color="fg">
        {label}
      </Text>
    </HStack>
  );
}
