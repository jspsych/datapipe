import { Box } from "@chakra-ui/react";

import LogoMark from "../LogoMark";

/**
 * The |> mark as ground texture on the landing page's CLOSING deep green band.
 *
 * WHICH BAND, AND WHY IT MOVED. It used to sit on the hero band, which was
 * type-only. The hero is two columns now and its right half is the opaque
 * near-black code device -- at the narrowest viewport this mark renders on,
 * the device spans x 712..1190 and the mark x 960..1280, so the panel would
 * have covered all but a ~90px sliver of it. The closing band is the page's
 * other deep-green ground and is still type-only, so the mark moved there
 * rather than being shrunk, faded, or deleted. It still appears exactly once
 * on the whole site.
 *
 * WHY THIS IS ALLOWED TO BE DECORATION. DESIGN.md §8 bans decorative icons
 * above headings, and the previous pass deleted three of them from this page
 * for good reason. This is a different thing: it is the brand's own geometry
 * at architectural scale, cropped by the band's edge, and it appears exactly
 * once on the whole site. It is not an icon labelling a heading; it is the
 * ground the heading sits on.
 *
 * CONTRAST (all against band.bg = brandGreen.900 #1B5E20, L 0.0834):
 *   bar + chevron 1  band.ornament = brandGreen.600 #43A047   2.38:1
 *   chevron 2 (echo) #8BC34A, LogoMark's own default          3.75:1
 * Both are decorative, aria-hidden, and carry no information -- WCAG 1.4.11
 * does not apply, and nothing here is a "graphical object required to
 * understand the content". The echo keeps its literal value because
 * DESIGN.md §1 is explicit that #8BC34A is mark-internal, identical in both
 * modes, and never a UI color: passing it through a token would be the start
 * of treating it as one. It is left as LogoMark's untouched default rather
 * than restated here, so this file holds no color literal at all.
 *
 * NO TEXT EVER SITS ON IT. White body copy over the #43A047 strokes would be
 * 3.31:1 -- under the body floor -- so the mark is confined to viewports wide
 * enough to keep it clear of the text column:
 *
 *   xl breakpoint       1280px minimum viewport
 *   band content        maxW 1100px, centred -> >=90px side margin
 *   closing-band prose  maxW 70ch; at `lg` 18px that is ~630px, so the
 *                       widest line ends at x <= 720
 *   this mark           420px wide, right: -100px -> starts at x >= 960
 *
 * That is 240px of clearance at the narrowest viewport it renders on (the
 * heading is maxW 20ch and the fine print is 14px, both narrower still), and
 * more on every wider one. Below xl it does not render at all, rather than
 * shrinking into an overlap. `overflow: hidden` on the band does the
 * cropping; `pointerEvents: none` keeps it out of the way of the CTA.
 */
export default function BandMark() {
  return (
    <Box
      aria-hidden="true"
      pointerEvents="none"
      position="absolute"
      top="0"
      right="-100px"
      zIndex={0}
      display={{ base: "none", xl: "block" }}
    >
      {/* LogoMark writes `color` straight onto SVG fill/stroke attributes,
          so it needs a resolved CSS value rather than a Chakra token path --
          the same reason components/Navbar.js passes
          var(--chakra-colors-logo-mark) to it. */}
      <LogoMark size={420} color="var(--chakra-colors-band-ornament)" />
    </Box>
  );
}
