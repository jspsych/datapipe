import { Center, Spinner } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect } from "react";

// The FAQ folded into /docs (docs IA plan §2.5/§2.6). Every item-N anchor
// that used to live on this page has a new home there; this file's only job
// now is to send a reader holding an old /faq or /faq#item-N link to the
// right one.
//
// This has to be a client-side redirect, not a next.config.js `redirects()`
// entry: browsers never send the URL fragment to the server, and a
// fragment-less server redirect target *keeps* the original fragment, so
// /faq#item-11 would land on /docs#item-11 -- an anchor that does not exist
// there -- and silently strand the reader at the top of the wrong page.
// Reading window.location.hash here and choosing the destination ourselves
// is what avoids that. The hash-reading approach mirrors what this page
// itself used to do to scroll to an accordion item.
//
// Every target below is a live section id, verified against lib/docs-nav.js.
export const FAQ_REDIRECTS = {
  "item-0": "/docs#how-it-works",
  "item-0b": "/docs/providers/osf",
  "item-1": "/docs#what-datapipe-does-not-do",
  "item-2": "/docs/data#what-datapipe-stores",
  "item-2b": "/docs/data/failures",
  "item-2c": "/docs/data/files#dont-edit-your-storage-during-collection",
  "item-3": "/docs/about#cost",
  "item-4": "/docs/about#cost",
  "item-5": "/docs/about#funding",
  "item-6": "/docs/data#who-can-see-it",
  "item-7": "/docs/about#risks",
  "item-8": "/docs/experiments/validation#how-validation-works",
  "item-9": "/docs/experiments/sending-data#media-and-binary-files",
  "item-9b": "/docs/experiments/sending-data#request-size-limits",
  "item-10": "/docs/experiments/conditions",
  "item-11": "/docs/experiments/metadata",
  "item-12": "/docs/providers/connecting#how-permission-works",
  "item-13": "/docs/about#citing",
};

export default function FAQRedirect() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    const destination = (hash && FAQ_REDIRECTS[hash]) || "/docs";
    router.replace(destination);
    // Re-run if a reader lands here, then changes the hash without a full
    // navigation (e.g. following another #item-N link while this frame is
    // still up) -- the old page handled hashchange the same way.
    function onHashChange() {
      const nextHash = window.location.hash.replace("#", "");
      router.replace((nextHash && FAQ_REDIRECTS[nextHash]) || "/docs");
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Center w="100%" py={20}>
      <Spinner color="brandGreen.solid" size="xl" />
    </Center>
  );
}
