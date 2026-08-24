// Single source of truth for the /docs section's information architecture.
//
// This one array drives: the sidebar (components/docs/DocsSidebar.js), the
// prev/next pager (components/docs/DocsPager.js), the "where to start" map on
// the documentation overview page, and the FAQ_REDIRECTS validation that
// Package E's /faq shim will build against. One file to edit when a page is
// added or reordered; nothing else in the docs section hand-maintains a page
// list or a section list.
//
// Sidebar order IS reading order and drives prev/next -- see the docs IA plan
// §2.3. Do not reorder groups or pages without updating that plan.
//
// Section ids are contract-stable anchors (docs IA plan §2.4): the FAQ
// redirect map and the existing `/faq#item-N` deep links (getting-started.js,
// pages/index.js) target them by id. They are hand-written here, never
// derived from heading text, so a copy edit can never silently break an
// inbound link. components/docs/DocsSection.js asserts (dev-only) that every
// id actually rendered on a page matches the list below exactly.

export const DOCS_NAV = [
  {
    group: "Overview",
    pages: [
      {
        href: "/docs",
        label: "Documentation overview",
        sections: [
          { id: "how-it-works", label: "How it works" },
          { id: "what-datapipe-does-not-do", label: "What DataPipe does not do" },
          { id: "where-to-start", label: "Where to start" },
        ],
      },
    ],
  },
  {
    group: "Storage providers",
    pages: [
      {
        href: "/docs/providers",
        label: "Choosing a provider",
        sections: [
          { id: "comparison", label: "Comparing the providers" },
          { id: "accounts-you-need", label: "Accounts you need" },
          { id: "one-provider-per-experiment", label: "One provider per experiment" },
          { id: "provider-specific-behavior", label: "Provider-specific behavior" },
          { id: "osf", label: "OSF" },
        ],
      },
      {
        href: "/docs/providers/connecting",
        label: "Connecting and reconnecting",
        sections: [
          { id: "how-permission-works", label: "How permission works" },
          { id: "google-drive", label: "Google Drive" },
          { id: "zenodo", label: "Zenodo" },
          { id: "dataverse", label: "Dataverse" },
          { id: "when-a-token-expires", label: "When a token expires" },
          { id: "reconnecting", label: "Reconnecting" },
          { id: "disconnecting", label: "Disconnecting" },
        ],
      },
      {
        href: "/docs/providers/osf",
        label: "Moving off OSF",
        sections: [
          { id: "what-changes", label: "What changes" },
          { id: "your-existing-data", label: "Your existing data" },
          { id: "how-to-move", label: "How to move" },
        ],
      },
    ],
  },
  {
    group: "Collecting data",
    pages: [
      {
        href: "/docs/experiments",
        label: "Creating an experiment",
        sections: [
          { id: "create", label: "Creating your experiment" },
          { id: "the-dashboard", label: "The dashboard" },
          { id: "renaming", label: "Renaming an experiment" },
          { id: "switches", label: "The four switches" },
        ],
      },
      {
        href: "/docs/experiments/sending-data",
        label: "Sending data from your experiment",
        sections: [
          { id: "jspsych", label: "jsPsych" },
          { id: "plain-javascript", label: "Plain JavaScript" },
          { id: "filenames-must-be-unique", label: "Filenames must be unique" },
          { id: "media-and-binary-files", label: "Media and binary files" },
          { id: "request-size-limits", label: "Request size limits" },
          { id: "what-the-response-means", label: "What the response means" },
        ],
      },
      {
        href: "/docs/experiments/conditions",
        label: "Condition assignment",
        sections: [
          { id: "how-many-conditions", label: "How many conditions" },
          { id: "what-it-is-not", label: "What it is not" },
          { id: "factorial-designs", label: "Factorial designs" },
        ],
      },
      {
        href: "/docs/experiments/validation",
        label: "Validation and session limits",
        sections: [
          { id: "how-validation-works", label: "How validation works" },
          { id: "required-fields", label: "Required fields" },
          { id: "rejected-data-is-gone", label: "Rejected data is gone" },
          { id: "validation-with-no-formats-allowed", label: "Validation with no formats allowed" },
          { id: "session-limits", label: "Session limits" },
          { id: "security-posture", label: "Security posture" },
        ],
      },
      {
        href: "/docs/experiments/metadata",
        label: "Psych-DS metadata",
        sections: [
          { id: "what-gets-written", label: "What gets written" },
          { id: "folder-names-are-flattened", label: "Folder names are flattened" },
          { id: "where-descriptions-come-from", label: "Where descriptions come from" },
          { id: "how-it-merges-across-sessions", label: "How it merges across sessions" },
          { id: "metadata-never-blocks-your-data", label: "Metadata never blocks your data" },
        ],
      },
    ],
  },
  {
    group: "Your data",
    pages: [
      {
        href: "/docs/data",
        label: "What DataPipe stores",
        sections: [
          { id: "what-datapipe-stores", label: "What DataPipe stores" },
          { id: "who-can-see-it", label: "Who can see it" },
          { id: "what-we-log", label: "What we log" },
          { id: "retention", label: "Retention" },
        ],
      },
      {
        href: "/docs/data/failures",
        label: "When an upload fails",
        sections: [
          { id: "what-202-means", label: "What a 202 means" },
          { id: "the-retry-schedule", label: "The retry schedule" },
          { id: "the-queued-files-panel", label: "The queued files panel" },
          { id: "downloading-queued-files", label: "Downloading queued files" },
          { id: "when-retries-run-out", label: "When retries run out" },
        ],
      },
      {
        href: "/docs/data/files",
        label: "Filenames, archives and your storage",
        sections: [
          { id: "how-filenames-are-checked", label: "How filenames are checked" },
          { id: "dont-edit-your-storage-during-collection", label: "Don't edit your storage during collection" },
          { id: "what-your-files-are-named", label: "What your files are named" },
          { id: "archives-during-collection", label: "Archives during collection" },
          { id: "file-count-limits", label: "File count limits" },
        ],
      },
      {
        href: "/docs/data/finalizing",
        label: "Finishing a study",
        sections: [
          { id: "what-finalizing-does", label: "What finalizing does" },
          { id: "which-providers-support-it", label: "Which providers support it" },
          { id: "queued-uploads-must-drain-first", label: "Queued uploads must drain first" },
          { id: "it-cannot-be-undone", label: "It cannot be undone" },
          { id: "publishing-is-still-your-call", label: "Publishing is still your call" },
        ],
      },
    ],
  },
  {
    group: "Reference",
    pages: [
      {
        href: "/docs/api",
        label: "API reference",
        sections: [
          { id: "limits", label: "Limits" },
          { id: "save-text-data", label: "Save text data" },
          { id: "save-base64-data", label: "Save base64-encoded data" },
          { id: "get-condition", label: "Get condition assignment" },
          { id: "responses", label: "Responses" },
          { id: "error-codes", label: "Error codes" },
          { id: "queue-status", label: "Queue status" },
          { id: "finalize", label: "Finalize" },
        ],
      },
      {
        href: "/docs/account",
        label: "Account and security",
        sections: [
          { id: "sign-in-methods", label: "Sign-in methods" },
          { id: "how-credentials-are-stored", label: "How credentials are stored" },
          { id: "disconnecting-a-provider", label: "Disconnecting a provider" },
          { id: "deleting-your-account", label: "Deleting your account" },
        ],
      },
    ],
  },
  {
    // Ungrouped, last -- docs IA plan §2.3: "About DataPipe ... (ungrouped, last)".
    // `group: null` tells DocsSidebar to render this page's link without a
    // group heading above it.
    group: null,
    pages: [
      {
        href: "/docs/about",
        label: "About DataPipe",
        sections: [
          { id: "cost", label: "Cost" },
          { id: "funding", label: "Funding" },
          { id: "risks", label: "Risks" },
          { id: "support", label: "Support" },
          { id: "citing", label: "Citing DataPipe" },
        ],
      },
    ],
  },
];

// The Getting Started guide is a cross-link INTO the docs section, not a
// /docs page itself -- docs IA plan §2.2: "It is not a /docs page. It appears
// as the first sidebar entry, set apart, as a cross-link out of the docs
// section." Kept separate from DOCS_NAV so it never participates in
// flattening, prev/next, or the section-id contract.
export const GETTING_STARTED_LINK = {
  href: "/getting-started",
  label: "Getting started guide",
};

// Same shape and same reasoning as GETTING_STARTED_LINK: /privacy is not a
// /docs page (it has its own layout and audience -- IRB reviewers get sent
// straight to it), so it hangs off the sidebar as a standalone cross-link
// after the groups rather than joining DOCS_NAV's reading order.
export const PRIVACY_LINK = {
  href: "/privacy",
  label: "Privacy & Information for IRBs",
};

// Flattens DOCS_NAV into one ordered list of pages, each carrying its group
// name. This *is* the reading order (docs IA plan §2.3), and it is what
// DocsPager and the section-id assertion walk.
export function flattenDocsPages(nav = DOCS_NAV) {
  const flat = [];
  for (const { group, pages } of nav) {
    for (const page of pages) {
      flat.push({ ...page, group });
    }
  }
  return flat;
}

// Looks up a /docs page by its route pathname (exact match -- every /docs
// route in this tree is static, no dynamic segments) and returns its group,
// its position, and its immediate neighbors in reading order. Returns null
// for a pathname outside the docs tree (including /getting-started, which is
// deliberately not part of DOCS_NAV).
export function findDocsPage(pathname) {
  const flat = flattenDocsPages();
  const index = flat.findIndex((page) => page.href === pathname);
  if (index === -1) return null;
  return {
    page: flat[index],
    group: flat[index].group,
    index,
    prevPage: index > 0 ? flat[index - 1] : null,
    nextPage: index < flat.length - 1 ? flat[index + 1] : null,
  };
}
