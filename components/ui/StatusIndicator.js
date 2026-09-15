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
 * Contrast: icon colors are the semantic `status.*` tokens from
 * lib/theme.js (DESIGN.md §1 status aliases -- one green, no blue), so
 * every value is mode-aware and computed in both modes against the worst
 * permitted surface:
 *   - ok / CircleCheck: `status.ok` = brandGreen.800 light (4.77:1) /
 *     brandGreen.300 dark (6.71:1).
 *   - warning / TriangleAlert: `status.warning` = brandOrange.800 light
 *     (6.63:1) / brandOrange.300 dark (7.80:1).
 *   - error / CircleX: `status.error` = brandRed.700 light (5.92:1) /
 *     brandRed.300 dark (4.86:1 on bg.muted, the worst case).
 *   - neutral / Minus: `status.neutral` = gray.700 light / gray.300 dark
 *     (8.30:1 / 9.14:1).
 *   All clear the 3:1 floor WCAG 1.4.11 sets for non-text UI (icons count
 *   as non-text) in BOTH modes -- an earlier revision hardcoded dark-mode
 *   palette steps here, which measured 2.39-2.61:1 on the light page.
 *   - Label: `color="fg"` -> 13.16:1 light / 12.94:1 dark (worst case
 *     bg.muted), well above the 4.5:1 body-text floor.
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
// style props -- lucide-react's `color` prop is not token-aware. These are
// the semantic `status.*` vars, so they resolve per color mode.
const STATUS_COLORS = {
  ok: "var(--chakra-colors-status-ok)",
  warning: "var(--chakra-colors-status-warning)",
  error: "var(--chakra-colors-status-error)",
  neutral: "var(--chakra-colors-status-neutral)",
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
    <HStack gap={2} display="inline-flex" alignItems="center">
      <Icon aria-hidden="true" size={size} color={color} />
      <Text fontSize="sm" color="fg">
        {label}
      </Text>
    </HStack>
  );
}
