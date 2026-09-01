import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// QueuePanel imports `auth` from lib/firebase for its download handlers;
// mock it out the same way index.test.jsx does so module init doesn't
// require a real Firebase config.
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: null },
  db: {},
}));

import QueuePanel from "../components/dashboard/QueuePanel";

const entries = [
  {
    id: "e1",
    filename: "sub-01_data.csv",
    status: "pending",
    failureReason: "interrupted upload",
    createdAt: new Date(),
    nextRetryAt: null,
  },
  {
    id: "e2",
    filename: "sub-02_data.csv",
    status: "failed",
    failureReason: "OSF error 503: Service Unavailable",
    createdAt: new Date(),
  },
  {
    id: "e3",
    filename: "sub-03_data.csv",
    status: "failed",
    failureReason: "Provider error 429: Too Many Requests",
    createdAt: new Date(),
  },
];

// Entries carrying the provider-agnostic taxonomy code, which is now the
// preferred classification. The three above deliberately have NO
// providerErrorCode -- they pin the legacy status/string fallback for queue
// docs written before that field existed.
const codedEntries = [
  {
    id: "c1",
    filename: "sub-10_data.csv",
    status: "pending",
    providerErrorCode: "CONTENTION",
    // A raw, alarming reason that must NOT reach the researcher now that a
    // taxonomy code is present.
    failureReason: "Provider error 400: Failed to add file to dataset.",
    createdAt: new Date(),
    nextRetryAt: null,
  },
  {
    id: "c2",
    filename: "sub-11_data.csv",
    status: "failed",
    providerErrorCode: "QUOTA_EXCEEDED",
    failureReason: "Provider error 400: This file size (2.0 GB) exceeds the size limit of 1.0 GB.",
    createdAt: new Date(),
  },
];

function renderCodedPanel() {
  return render(
    <ChakraProvider value={system}>
      <QueuePanel entries={codedEntries} experimentId="exp1" />
    </ChakraProvider>
  );
}

function renderPanel() {
  return render(
    <ChakraProvider value={system}>
      <QueuePanel entries={entries} experimentId="exp1" />
    </ChakraProvider>
  );
}

describe("QueuePanel — provider-neutral copy", () => {
  it("14. generalizes alert/reason copy away from 'OSF' while keeping filenames literal", () => {
    renderPanel();

    // Pinned legacy behavior: filenames are untouched, provider-agnostic
    // data that must not be paraphrased.
    expect(screen.getByText("sub-01_data.csv")).toBeInTheDocument();
    expect(screen.getByText("sub-02_data.csv")).toBeInTheDocument();

    // Alert title/description: "did not upload to OSF" -> "did not upload
    // to your storage provider" (spec's own example phrasing).
    expect(
      screen.getByText(/did not upload to your storage provider/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/did not upload to OSF/i)
    ).not.toBeInTheDocument();

    // friendlyReason mapping: "OSF was temporarily unavailable." ->
    // generalized "storage provider" phrasing.
    expect(
      screen.getByText(/storage provider was temporarily unavailable/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/^OSF was temporarily unavailable\.?$/i)
    ).not.toBeInTheDocument();

    // Both the legacy "OSF error <status>" prefix (older queue docs) and
    // the current "Provider error <status>" prefix must map to friendly
    // copy — neither raw string may reach the UI.
    expect(
      screen.getByText(/storage provider rate-limited the request/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Provider error 429/)
    ).not.toBeInTheDocument();
  });
});

describe("QueuePanel provider error taxonomy", () => {
  it("CONTENTION reads as routine and self-resolving, not as a raw 400", () => {
    renderCodedPanel();

    expect(
      screen.getByText(/busy with another upload from this experiment/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/retried automatically/i)).toBeInTheDocument();
    // The raw provider string must not leak through -- it reads like data
    // loss for what is a benign, auto-resolving collision.
    expect(
      screen.queryByText(/Failed to add file to dataset/i)
    ).not.toBeInTheDocument();
  });

  it("QUOTA_EXCEEDED is explained rather than shown as a 400", () => {
    renderCodedPanel();

    expect(
      screen.getByText(/out of space, or this file is larger than it allows/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/exceeds the size limit/i)).not.toBeInTheDocument();
  });

  // The copy used to be chosen from the code alone, ignoring status, so a row
  // that had exhausted every retry sat under a "Failed" badge still promising
  // the upload "is being retried automatically" -- which reads as "no action
  // needed" at the exact moment downloading the file by hand is the only
  // thing that will save it.
  it("withholds the still-retrying reassurance once an entry has permanently failed", () => {
    const failedContention = [
      {
        id: "f1",
        filename: "sub-12_data.csv",
        status: "failed",
        providerErrorCode: "CONTENTION",
        failureReason: "Upload sub-12_data.csv permanently failed after 5 retries",
        createdAt: new Date(),
      },
    ];

    render(
      <ChakraProvider value={system}>
        <QueuePanel entries={failedContention} experimentId="exp1" />
      </ChakraProvider>
    );

    // The cause is still explained...
    expect(
      screen.getByText(/busy with another upload from this experiment/i)
    ).toBeInTheDocument();
    // ...but nothing claims a retry is still coming.
    expect(screen.queryByText(/retried automatically/i)).not.toBeInTheDocument();
  });

  // Only a provider WriteResult produces a taxonomy code, so every failure
  // that never reached the provider falls through to prose matching. These
  // used to render the raw internal string in the researcher's Reason column.
  describe("failures that carry no taxonomy code", () => {
    function renderReason(failureReason) {
      render(
        <ChakraProvider value={system}>
          <QueuePanel
            entries={[{ id: "n1", filename: "sub-13_data.csv", status: "failed", failureReason, createdAt: new Date() }]}
            experimentId="exp1"
          />
        </ChakraProvider>
      );
    }

    it.each([
      ["Token resolution failed: PROVIDER_NOT_CONNECTED", /could not authenticate with your storage provider/i],
      ["Token resolution exception: socket hang up", /could not authenticate with your storage provider/i],
      ["Owner user not found", /no longer exists/i],
      ["Experiment not found", /no longer exists/i],
      ["Collision cache rehydrating", /still checking this experiment's existing filenames/i],
      ["Failed to read cached data: no such object", /could not read its own saved copy/i],
    ])("explains %j instead of printing it verbatim", (failureReason, expected) => {
      renderReason(failureReason);
      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(screen.queryByText(failureReason)).not.toBeInTheDocument();
    });

    // Ordering guard: the interpolated detail on a cache failure can itself
    // contain "fetch failed", which the generic network matcher would
    // otherwise claim first and report as a mere connection problem.
    it("reports a rehydration failure as such even when its detail says 'fetch failed'", () => {
      renderReason("Collision cache rehydration failed: Rehydration failed for experiment x: fetch failed");
      expect(screen.getByText(/could not read the existing files/i)).toBeInTheDocument();
      expect(screen.queryByText(/Could not connect to your storage provider/i)).not.toBeInTheDocument();
    });

    it("still maps the pre-taxonomy 'OSF error <status>' shape", () => {
      renderReason("OSF error 503: Service Unavailable");
      expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
    });
  });

  // One code, genuinely different provider behavior. Zenodo maps its
  // 100-files-per-record cap to QUOTA_EXCEEDED, where the generic "out of
  // space, or this file is larger than it allows" is wrong in both halves.
  describe("provider-specific overrides", () => {
    function renderQuotaEntry(storageProvider) {
      render(
        <ChakraProvider value={system}>
          <QueuePanel
            entries={[
              {
                id: "q1",
                filename: "sub-101_data.csv",
                status: "failed",
                providerErrorCode: "QUOTA_EXCEEDED",
                storageProvider,
                failureReason: "Provider error 400: Uploading selected files will result in exceeding the max amount per record.",
                createdAt: new Date(),
              },
            ]}
            experimentId="exp1"
          />
        </ChakraProvider>
      );
    }

    it("names Zenodo's file cap rather than claiming the account is out of space", () => {
      renderQuotaEntry("zenodo");
      expect(screen.getByText(/100 files, or 50 GB/i)).toBeInTheDocument();
      expect(screen.queryByText(/out of space/i)).not.toBeInTheDocument();
    });

    it("keeps the generic copy for a provider with no override", () => {
      renderQuotaEntry("dataverse");
      expect(
        screen.getByText(/out of space, or this file is larger than it allows/i)
      ).toBeInTheDocument();
    });

    // Legacy OSF queue docs carry no storageProvider field at all.
    it("keeps the generic copy when the entry has no storageProvider", () => {
      renderQuotaEntry(undefined);
      expect(
        screen.getByText(/out of space, or this file is larger than it allows/i)
      ).toBeInTheDocument();
    });
  });

  it("the taxonomy code wins over the status embedded in failureReason", () => {
    // c1's failureReason carries a 400 that the legacy path would have shown
    // verbatim; the code is what decides the copy now.
    renderCodedPanel();
    expect(screen.queryByText(/^Provider error 400/)).not.toBeInTheDocument();
  });
});
