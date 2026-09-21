import { useRef, useState, useSyncExternalStore } from "react";
import { Button, CloseButton, Dialog, Text } from "@chakra-ui/react";
import NextLink from "next/link";

// WHY THIS EXISTS, AND WHY IT IS NOT A PRECEDENT.
//
// DESIGN.md §8 bans "modal as first thought" -- dialogs are for confirming a
// consequence, not for holding something that fits on a page. This is a
// deliberate, maintainer-requested exception to that rule for exactly one
// thing: a one-time announcement of the September 2026 release, pointing at
// /docs/whats-changed. It is not a pattern to reuse for the next feature
// announcement, a newsletter signup, or anything else that isn't "read this
// once, or don't." If you're tempted to copy this for something else, put
// that something else inline or in progressive disclosure instead, the way
// DESIGN.md §8 asks, and raise the exception with the maintainer again if you
// think it's warranted.
//
// PERSISTENCE. Same pattern as components/OsfSunsetBanner.js, on purpose --
// this is a second instance of the same problem (a one-time, dismissible
// homepage announcement), and it should not invent a second solution.
// Versioned localStorage key, reads wrapped in try/catch, useSyncExternalStore
// with a server snapshot of "dismissed" so nothing renders on the server or
// flashes during hydration, and a session-local flag so the dialog still
// closes for this visit when storage is unavailable (Safari private
// browsing, "block all cookies", some embedded webviews). Per-browser, not
// per-account, for the same reason the banner is: this fires on the
// signed-out homepage as often as the signed-in one, and there is no account
// to attach the dismissal to until someone signs in.
const DISMISS_KEY = "datapipe:announcement:whats-changed:v1";

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Ignored: the dialog still closes for this session (see `dismissedNow`
    // below), it just comes back on the next visit.
  }
}

// Nothing mutates localStorage behind this component's back within a
// session, so there is no external change to subscribe to -- same no-op as
// OsfSunsetBanner.js.
const subscribeToNothing = () => () => {};

// Homepage-only, one-time announcement of the September 2026 release.
// Mounted from pages/index.js alone -- not _app.js, not the dashboard, not
// the docs section, which already carries its own pointer to the same page
// (see the GuidanceLine atop pages/docs/index.js).
export default function WhatsChangedModal() {
  const dismissedBefore = useSyncExternalStore(
    subscribeToNothing,
    readDismissed,
    // Server snapshot: always "dismissed", so the static HTML never contains
    // the dialog and it cannot flash open for a visitor who already closed
    // it before this render is replaced on hydration.
    () => true
  );
  const [dismissedNow, setDismissedNow] = useState(false);

  const primaryRef = useRef(null);

  const open = !dismissedBefore && !dismissedNow;

  // The one path every dismissal runs through: the primary link, the
  // "Dismiss" button (via Dialog.CloseTrigger), the × control (also a
  // CloseTrigger), and Escape/backdrop (Ark's own default `closeOnEscape` /
  // `closeOnInteractOutside`, which both route through onOpenChange) all end
  // up here. All four clear it for good.
  function dismiss() {
    setDismissedNow(true);
    rememberDismissal();
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) dismiss();
      }}
      initialFocusEl={() => primaryRef.current}
    >
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content
          bg="bg.panel"
          color="fg"
          borderWidth="1px"
          borderColor="border"
        >
          <Dialog.CloseTrigger asChild>
            <CloseButton size="sm" aria-label="Close" />
          </Dialog.CloseTrigger>

          <Dialog.Header>
            <Dialog.Title fontSize="lg" fontWeight="bold">
              DataPipe has changed
            </Dialog.Title>
          </Dialog.Header>

          <Dialog.Body>
            <Dialog.Description asChild>
              <Text color="fg">
                A large update went out in September 2026: new storage
                providers, saving data as the experiment runs, and a few
                changes that can affect existing code. Experiments that are
                already running keep collecting data.
              </Text>
            </Dialog.Description>
          </Dialog.Body>

          <Dialog.Footer gap={3}>
            {/* A plain button, NOT a second Dialog.CloseTrigger. In Chakra v3
                CloseTrigger is not just behaviour: it is the dialog recipe's
                `closeTrigger` slot, which is positioned absolutely in the
                top corner (pos: absolute; top: 2; insetEnd: 2). Wrapping this
                button in one lifted it out of the footer and onto the x
                above. ConfirmDialog's Cancel is a plain button for the same
                reason. */}
            <Button variant="outline" onClick={dismiss}>
              Dismiss
            </Button>
            {/* The one primary action per screen (DESIGN.md §5). The
                homepage's own primary ("Create an account" / "Go to my
                experiments") is the hero's CTA, off-screen behind this
                dialog's backdrop -- a modal has its own screen for the
                purposes of that rule, the same way ConfirmDialog's solid
                confirm button is a second brandGreen.solid control on a page
                that already has one elsewhere. A real link, not a button
                that navigates imperatively, so it works with no JS and is
                right-click-openable -- and still clears the announcement,
                via the explicit onClick, because leaving through the link is
                as much "done with this" as any other close. */}
            <Button asChild colorPalette="brandGreen" onClick={dismiss}>
              <NextLink ref={primaryRef} href="/docs/whats-changed">
                See what&apos;s changed
              </NextLink>
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
