import { Box } from "@chakra-ui/react";

import LogoMark from "../LogoMark";

/**
 * The |> mark as ground texture on the landing page's CLOSING section.
 *
 * WHICH SECTION, AND WHY IT MOVED. It used to sit on the hero, which was
 * type-only. The hero is two columns now and its right half is the opaque
 * near-black code device -- at the narrowest viewport this mark renders on,
 * the device spans x 712..1190 and the mark x 960..1280, so the panel would
 * have covered all but a ~90px sliver of it. The closing section is the
 * page's other full-bleed ground and is still type-only, so the mark moved
 * there rather than being shrunk, faded, or deleted. It still appears
 * exactly once on the whole site.
 *
 * WHY THIS IS ALLOWED TO BE DECORATION. DESIGN.md §8 bans decorative icons
 * above headings, and an earlier pass deleted three of them from this page
 * for good reason. This is a different thing: it is the brand's own geometry
 * at architectural scale, cropped by the section's edge, and it appears
 * exactly once on the whole site. It is not an icon labelling a heading; it
 * is the ground the heading sits on.
 *
 * COLOR. The closing section is the page's one deep green band (see the
 * GREEN BUDGET note in pages/index.js), and the mark is drawn on it in
 * `band.ornament` = brandGreen.600 #43A047 -- 2.38:1 against #1B5E20, a
 * shape you notice on the second look rather than one that competes with
 * the white CTA beside it. The echo chevron keeps LogoMark's stock #8BC34A,
 * which is exactly the mark-internal use DESIGN.md §1 allows it: 3.75:1 on
 * the band, never promoted to a UI color.
 *
 * WCAG does not apply to it either way. It is `aria-hidden`, carries no
 * information, and is not a "graphical object required to understand the
 * content", so 1.4.11's 3:1 floor is not in play.
 *
 * The echo chevron is neutralised too, one step dimmer (`bg.muted` #2A2F34,
 * 1.31:1) so the mark keeps its two-tone geometry without either tone being
 * a color. Its stock #8BC34A was the brightest green anywhere on the page --
 * 3.75:1 on the old green band, and a 420px shape of it. Recolouring is
 * legitimate here because this is not a logo USAGE: the navbar renders the
 * real lockup in `logo.mark`, and this instance has always been a texture
 * rendering with its color passed in (it was `band.ornament` before). The
 * brand rule DESIGN.md §1 states about #8BC34A -- mark-internal, never a UI
 * color -- is respected by not promoting it, not by reproducing it here.
 *
 * NO TEXT EVER SITS ON IT. The mark is confined to viewports wide enough to
 * keep it clear of the text column:
 *
 *   xl breakpoint          1280px minimum viewport
 *   section content        maxW 1100px, centred -> >=90px side margin
 *   closing-section prose  maxW 70ch; at `lg` 18px that is ~630px, so the
 *                          widest line ends at x <= 720
 *   this mark              420px wide, right: -100px -> starts at x >= 960
 *
 * That is 240px of clearance at the narrowest viewport it renders on (the
 * heading is maxW 20ch and the fine print is 14px, both narrower still), and
 * more on every wider one. Below xl it does not render at all, rather than
 * shrinking into an overlap. `overflow: hidden` on the section does the
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
