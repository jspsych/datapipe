import fs from "fs";
import path from "path";
import { DOCS_NAV, flattenDocsPages } from "../lib/docs-nav";

// Maps a /docs href to the page file it must resolve to under pages/docs, the
// same routing rule Next's pages router itself applies: "/docs" is the
// section's own index route, and every other href is either a file
// (pages/docs/x.js) or a directory index (pages/docs/x/index.js).
function pageFileFor(href) {
  const withoutLeadingSlash = href.replace(/^\//, "");
  const asFile = path.join(process.cwd(), "pages", `${withoutLeadingSlash}.js`);
  if (fs.existsSync(asFile)) return asFile;
  const asIndex = path.join(process.cwd(), "pages", withoutLeadingSlash, "index.js");
  if (fs.existsSync(asIndex)) return asIndex;
  return null;
}

describe("DOCS_NAV", () => {
  it("lists 'What's changed' as the first entry, ahead of every group", () => {
    const firstGroup = DOCS_NAV[0];
    expect(firstGroup.pages).toHaveLength(1);
    expect(firstGroup.pages[0].href).toBe("/docs/whats-changed");
    expect(firstGroup.pages[0].label).toBe("What's changed");
  });

  it("every page's href resolves to a page file under pages/docs", () => {
    for (const page of flattenDocsPages()) {
      expect(page.href.startsWith("/docs")).toBe(true);
      expect(pageFileFor(page.href)).not.toBeNull();
    }
  });
});
