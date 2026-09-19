import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

import { auth } from "../lib/firebase";
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

    // Alert title: e1 is now classified "waiting" (never attempted, held
    // reason), e2/e3 are "failed" -- the "failed, with others still moving"
    // headline case, not the old blanket "did not upload" wording.
    expect(
      screen.getByText(/could not be uploaded to your storage provider/i)
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

// -----------------------------------------------------------------------
// Three-kind classification: waiting / retrying / failed, and the four
// headline+body cases they produce. See lib/upload-queue.js's
// queueEntryKind/summarizeQueue and QueuePanel.js's summaryText.
// -----------------------------------------------------------------------

const failedEntry = {
  id: "k-failed",
  filename: "sub-90_data.csv",
  status: "failed",
  failureReason: "Provider error 500: Internal Server Error",
  createdAt: new Date(),
};

const retryingEntry = {
  id: "k-retrying",
  filename: "sub-91_data.csv",
  status: "pending",
  retryCount: 1,
  lastAttemptAt: new Date(),
  failureReason: "Upload exception: fetch failed",
  createdAt: new Date(),
  nextRetryAt: new Date(Date.now() + 57 * 60 * 1000),
};

// Never attempted, held for a known reason -- the "waiting" kind.
const waitingEntry = {
  id: "k-waiting-1",
  filename: "sub-92_data.csv",
  status: "pending",
  retryCount: 0,
  lastAttemptAt: null,
  failureReason: "Compaction in progress",
  createdAt: new Date(),
  nextRetryAt: new Date(Date.now() + 57 * 60 * 1000),
};

const waitingEntry2 = {
  id: "k-waiting-2",
  filename: "sub-93_data.csv",
  status: "pending",
  retryCount: 0,
  lastAttemptAt: null,
  failureReason: "Collision cache rehydrating",
  createdAt: new Date(),
};

function renderKinds(entries) {
  return render(
    <ChakraProvider value={system}>
      <QueuePanel entries={entries} experimentId="exp1" />
    </ChakraProvider>
  );
}

describe("QueuePanel — headline/body, all four cases", () => {
  it("all failed, singular", () => {
    renderKinds([failedEntry]);
    expect(
      screen.getByText("1 file could not be uploaded to your storage provider.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "All retries were exhausted. Download these files and upload them to your storage provider manually to prevent data loss."
      )
    ).toBeInTheDocument();
  });

  it("all failed, plural", () => {
    renderKinds([failedEntry, { ...failedEntry, id: "k-failed-2", filename: "sub-96.csv" }]);
    expect(
      screen.getByText("2 files could not be uploaded to your storage provider.")
    ).toBeInTheDocument();
  });

  it("failed with others, singular 'more file is'", () => {
    renderKinds([failedEntry, retryingEntry]);
    expect(
      screen.getByText("1 file could not be uploaded to your storage provider.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 more file is still being stored automatically\./)
    ).toBeInTheDocument();
  });

  it("failed with others, plural 'more files are'", () => {
    renderKinds([failedEntry, retryingEntry, waitingEntry]);
    expect(
      screen.getByText(/2 more files are still being stored automatically\./)
    ).toBeInTheDocument();
  });

  it("retrying only (nothing waiting, nothing failed)", () => {
    renderKinds([retryingEntry]);
    expect(
      screen.getByText("1 upload did not go through on the first try.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("DataPipe is retrying automatically. You can also download the files now.")
    ).toBeInTheDocument();
  });

  it("retrying with waiting", () => {
    renderKinds([retryingEntry, waitingEntry]);
    expect(
      screen.getByText("1 upload did not go through on the first try.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "DataPipe is retrying automatically. 1 more file is waiting to be stored. You can also download the files now."
      )
    ).toBeInTheDocument();
  });

  it("only waiting, singular ('One file is waiting to be stored.')", () => {
    renderKinds([waitingEntry]);
    expect(screen.getByText("One file is waiting to be stored.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DataPipe is storing these automatically; nothing has failed. You can download them now if you need them sooner."
      )
    ).toBeInTheDocument();
  });

  it("only waiting, plural ('N files are waiting to be stored.')", () => {
    renderKinds([waitingEntry, waitingEntry2]);
    expect(screen.getByText("2 files are waiting to be stored.")).toBeInTheDocument();
  });
});

describe("QueuePanel — row status by kind", () => {
  it("a waiting row shows 'Waiting to be stored' and a 'First attempt' sub-line", () => {
    renderKinds([waitingEntry]);
    // "Waiting to be stored" also appears as an accordion bullet lead-in, so
    // assert on the row itself rather than the bare string.
    expect(screen.getByRole("row", { name: /Waiting to be stored/ })).toBeInTheDocument();
    expect(screen.getByText(/First attempt/)).toBeInTheDocument();
    // Never "Next retry" -- nothing has been attempted yet.
    expect(screen.queryByText(/Next retry/)).not.toBeInTheDocument();
  });

  it("a retrying row shows 'Retrying' and a 'Next retry' sub-line", () => {
    renderKinds([retryingEntry]);
    expect(screen.getByRole("row", { name: /Retrying/ })).toBeInTheDocument();
    expect(screen.getByText(/Next retry/)).toBeInTheDocument();
    expect(screen.queryByText(/First attempt/)).not.toBeInTheDocument();
  });

  it("a failed row shows 'Failed' with no sub-line", () => {
    renderKinds([failedEntry]);
    // "Failed" also appears in the accordion's explanatory bullet, so assert
    // on the row's own StatusIndicator rather than the bare string.
    expect(screen.getByRole("row", { name: /Failed/ })).toBeInTheDocument();
    expect(screen.queryByText(/Next retry|First attempt/)).not.toBeInTheDocument();
  });
});

describe("QueuePanel — visual treatment follows tone, not just 'anything queued'", () => {
  it("renders no filled alert when tone is warning (retrying, nothing failed)", () => {
    renderKinds([retryingEntry]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders no filled alert when tone is neutral (only waiting entries)", () => {
    renderKinds([waitingEntry, waitingEntry2]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a filled alert as soon as any entry has failed", () => {
    renderKinds([failedEntry, waitingEntry]);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("QueuePanel — accordion", () => {
  it("trigger reads the new 'What is happening to these files?' copy", () => {
    renderKinds([waitingEntry]);
    expect(screen.getByText("What is happening to these files?")).toBeInTheDocument();
    expect(screen.queryByText("Why did these uploads fail?")).not.toBeInTheDocument();
  });
});

describe("QueuePanel — an all-waiting queue never reads as a failure", () => {
  it("says nothing about failing to upload or a server restart/memory limit", () => {
    renderKinds([waitingEntry, waitingEntry2]);
    expect(
      screen.queryByText(/did not upload to your storage provider/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/could not be uploaded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/server restart or memory limit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/interrupted/i)).not.toBeInTheDocument();
  });
});

describe("QueuePanel — downloads still call /api/queuestatus", () => {
  const entry = {
    id: "dl-1",
    filename: "sub-99_data.csv",
    status: "pending",
    retryCount: 0,
    lastAttemptAt: null,
    failureReason: "Compaction in progress",
    createdAt: new Date(),
  };

  let originalCurrentUser;

  beforeEach(() => {
    originalCurrentUser = auth.currentUser;
    auth.currentUser = { getIdToken: jest.fn().mockResolvedValue("test-token") };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["data"])),
    });
    global.URL.createObjectURL = jest.fn(() => "blob:mock");
    global.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    auth.currentUser = originalCurrentUser;
    delete global.fetch;
    jest.restoreAllMocks();
  });

  it("a per-row download hits /api/queuestatus?...&download=<entryId>", async () => {
    renderKinds([entry]);
    fireEvent.click(screen.getByRole("button", { name: `Download ${entry.filename}` }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][0]).toBe(
      `/api/queuestatus?experimentID=exp1&download=${entry.id}`
    );
  });

  it("'Download all as ZIP' hits /api/queuestatus?...&downloadAll=true", async () => {
    renderKinds([entry]);
    fireEvent.click(screen.getByRole("button", { name: /Download all as ZIP/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][0]).toBe(
      "/api/queuestatus?experimentID=exp1&downloadAll=true"
    );
  });
});
