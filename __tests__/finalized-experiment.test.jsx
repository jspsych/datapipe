import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

/**
 * Finalizing an experiment closes it. These tests pin the three places the
 * dashboard has to say so.
 *
 * The backend half -- finalization.ts writing `active: false` /
 * `activeBase64: false` in the same update as `finalized: true` -- is pinned
 * in functions/src/__tests__/finalization-emulator.test.js. What is pinned
 * HERE is that the UI does not depend on that write having happened: every
 * assertion below covers the legacy case where an experiment was finalized
 * before finalization started switching the flags off, so Firestore still
 * holds `active: true` on a sealed record. `finalized` is read first
 * everywhere, so those experiments render as closed rather than advertising
 * that they are collecting.
 */

const mockGetIdToken = jest.fn(() => Promise.resolve("id-token-123"));
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1", getIdToken: () => mockGetIdToken() } },
  db: {},
}));

// `doc()` returns its path so the useDocumentData mock below can tell the
// three subscriptions on the experiment page apart (contact email, the
// experiment, its logs) without a real Firestore.
jest.mock("firebase/firestore", () => ({
  doc: jest.fn((_db, ...segments) => ({ path: segments.join("/") })),
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  deleteDoc: jest.fn(() => Promise.resolve()),
  setDoc: jest.fn(() => Promise.resolve()),
}));

jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({
    user: { uid: "user-1" },
    loading: false,
  }),
}));

jest.mock("next/router", () => ({
  __esModule: true,
  default: { push: jest.fn() },
  useRouter: () => ({
    push: jest.fn(),
    pathname: "/admin",
    query: { experiment_id: "exp1" },
  }),
}));

// A signed-in user with a contact address, so AuthCheck's gate lets the page
// through to the content under test.
const USER_DOC = { contactEmail: "researcher@example.edu" };

let experimentDoc = null;
const mockUseDocumentData = jest.fn((ref) => {
  if (!ref) return [undefined, false, undefined];
  if (ref.path?.startsWith("users/")) return [USER_DOC, false, undefined];
  if (ref.path?.startsWith("experiments/")) {
    return [experimentDoc, false, undefined, { exists: () => true }];
  }
  return [null, false, undefined];
});

let experimentList = [];
const mockUseCollectionData = jest.fn((ref) => {
  // The experiment page's queue query and the list page's experiments query
  // both come through here; the queue one is `null` until a uid exists and
  // otherwise wants an empty array, which is what an unfinalized fixture
  // gives it anyway.
  if (ref === null) return [undefined, false, undefined];
  return [experimentList, false, undefined];
});

jest.mock("react-firebase-hooks/firestore", () => ({
  useDocumentData: (...args) => mockUseDocumentData(...args),
  useCollectionData: (...args) => mockUseCollectionData(...args),
}));

import ExperimentActive from "../components/dashboard/ExperimentActive";
import AdminPage from "../pages/admin/index";
import ExperimentPage from "../pages/admin/[experiment_id]";

function renderWithChakra(ui) {
  return render(<ChakraProvider value={system}>{ui}</ChakraProvider>);
}

const BASE_EXPERIMENT = {
  id: "exp1",
  title: "Word learning study",
  owner: "user-1",
  active: true,
  activeBase64: false,
  activeConditionAssignment: false,
  nConditions: 2,
  maxSessions: 100,
  limitSessions: false,
  sessions: 42,
  storageProvider: "zenodo",
  // ExperimentValidation and MetadataControl render alongside on the full
  // page, and both read from the same document.
  useValidation: false,
  allowJSON: true,
  allowCSV: true,
  requiredFields: [],
  metadataActive: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  experimentDoc = null;
  experimentList = [];
});

describe("ExperimentActive — data collection switches once finalized", () => {
  // Chakra's Switch renders a visually hidden `input type="checkbox"` as the
  // real control (Switch.HiddenInput), so that -- not a `switch` role -- is
  // what carries the label, the checked state and the disabled state.
  const switchFor = (name) =>
    screen.getByRole("checkbox", { name: new RegExp(name, "i") });

  it("leaves both collection switches live on an experiment that is not finalized", () => {
    renderWithChakra(<ExperimentActive data={{ ...BASE_EXPERIMENT }} />);

    expect(switchFor("Accept new data")).toBeEnabled();
    expect(switchFor("Accept new data")).toBeChecked();
    expect(switchFor("Accept base64 file uploads")).toBeEnabled();
  });

  it("locks both collection switches once the experiment is finalized, and says why", () => {
    renderWithChakra(
      <ExperimentActive
        data={{ ...BASE_EXPERIMENT, active: false, finalized: true }}
      />
    );

    expect(switchFor("Accept new data")).toBeDisabled();
    expect(switchFor("Accept base64 file uploads")).toBeDisabled();

    // A control that is off with no explanation reads as broken. Both rows
    // have to name finalizing as the reason.
    expect(
      screen.getAllByText(/Locked because this experiment has been finalized/i)
    ).toHaveLength(2);
  });

  it("shows a finalized experiment as not accepting data even when Firestore still holds active: true", () => {
    // The legacy shape: finalized before finalization switched the flags off.
    renderWithChakra(
      <ExperimentActive
        data={{
          ...BASE_EXPERIMENT,
          active: true,
          activeBase64: true,
          finalized: true,
        }}
      />
    );

    expect(switchFor("Accept new data")).not.toBeChecked();
    expect(switchFor("Accept base64 file uploads")).not.toBeChecked();
  });

  it("does not lock condition assignment, which a finalized experiment still does", () => {
    renderWithChakra(
      <ExperimentActive
        data={{ ...BASE_EXPERIMENT, active: false, finalized: true }}
      />
    );

    expect(switchFor("Assign conditions in sequence")).toBeEnabled();
  });
});

describe("Experiment list — finalized indicator", () => {
  it("shows Collecting data for a live experiment", () => {
    experimentList = [{ ...BASE_EXPERIMENT }];
    renderWithChakra(<AdminPage />);

    expect(screen.getByText("Collecting data")).toBeInTheDocument();
    expect(screen.queryByText("Finalized")).not.toBeInTheDocument();
  });

  it("shows Finalized in place of the collecting status once finalized", () => {
    experimentList = [{ ...BASE_EXPERIMENT, active: false, finalized: true }];
    renderWithChakra(<AdminPage />);

    expect(screen.getByText("Finalized")).toBeInTheDocument();
    expect(screen.queryByText("Collecting data")).not.toBeInTheDocument();
    expect(screen.queryByText("Not collecting")).not.toBeInTheDocument();
  });

  it("shows Finalized rather than Collecting data on a legacy finalized experiment", () => {
    experimentList = [{ ...BASE_EXPERIMENT, active: true, finalized: true }];
    renderWithChakra(<AdminPage />);

    expect(screen.getByText("Finalized")).toBeInTheDocument();
    expect(screen.queryByText("Collecting data")).not.toBeInTheDocument();
  });
});

describe("Experiment list — storage provider", () => {
  it("names the provider a current experiment is stored on", () => {
    experimentList = [{ ...BASE_EXPERIMENT, storageProvider: "gdrive" }];
    renderWithChakra(<AdminPage />);

    expect(screen.getByText("Stored on Google Drive")).toBeInTheDocument();
  });

  it("names Zenodo and Dataverse experiments too", () => {
    experimentList = [
      { ...BASE_EXPERIMENT, id: "a", storageProvider: "zenodo" },
      { ...BASE_EXPERIMENT, id: "b", storageProvider: "dataverse" },
    ];
    renderWithChakra(<AdminPage />);

    expect(screen.getByText("Stored on Zenodo")).toBeInTheDocument();
    expect(screen.getByText("Stored on Dataverse")).toBeInTheDocument();
  });

  it("names OSF for a legacy experiment with no storageProvider field", () => {
    const legacy = { ...BASE_EXPERIMENT, osfRepo: "abc12", osfComponent: "def34" };
    delete legacy.storageProvider;
    experimentList = [legacy];
    renderWithChakra(<AdminPage />);

    expect(screen.getByText("Stored on OSF")).toBeInTheDocument();
  });

  it("says nothing rather than guessing when the provider is unrecognised", () => {
    experimentList = [{ ...BASE_EXPERIMENT, storageProvider: "figshare" }];
    renderWithChakra(<AdminPage />);

    expect(screen.queryByText(/Stored on/)).not.toBeInTheDocument();
  });
});

describe("Experiment page — the Finalize section is offered only where it works", () => {
  it("offers finalizing on Zenodo, the one provider with a file-count cap", () => {
    experimentDoc = { ...BASE_EXPERIMENT, storageProvider: "zenodo" };
    renderWithChakra(<ExperimentPage />);

    expect(screen.getByText("Danger zone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /finalize/i })).toBeInTheDocument();
  });

  it("hides the whole Danger zone on Google Drive, which has no cap to relieve", () => {
    experimentDoc = { ...BASE_EXPERIMENT, storageProvider: "gdrive" };
    renderWithChakra(<ExperimentPage />);

    // Offering an irreversible action that would only ever be refused is
    // worse than not offering it -- and an empty Danger zone is its own kind
    // of alarming, so the section goes with the button.
    expect(screen.queryByText("Danger zone")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /finalize/i })
    ).not.toBeInTheDocument();
  });

  it("hides it on Dataverse for the same reason", () => {
    experimentDoc = { ...BASE_EXPERIMENT, storageProvider: "dataverse" };
    renderWithChakra(<ExperimentPage />);

    expect(screen.queryByText("Danger zone")).not.toBeInTheDocument();
  });

  it("hides it on a legacy OSF experiment, which is absent from the provider map", () => {
    const legacy = { ...BASE_EXPERIMENT, osfRepo: "abc12", osfComponent: "def34" };
    delete legacy.storageProvider;
    experimentDoc = legacy;
    renderWithChakra(<ExperimentPage />);

    expect(screen.queryByText("Danger zone")).not.toBeInTheDocument();
  });
});

describe("Experiment page header — finalized indicator", () => {
  it("shows Accepting data for a live experiment", () => {
    experimentDoc = { ...BASE_EXPERIMENT };
    renderWithChakra(<ExperimentPage />);

    expect(screen.getByText("Accepting data")).toBeInTheDocument();
    expect(screen.queryByText("Finalized")).not.toBeInTheDocument();
  });

  it("shows Finalized in place of the accepting status once finalized", () => {
    experimentDoc = { ...BASE_EXPERIMENT, active: false, finalized: true };
    renderWithChakra(<ExperimentPage />);

    expect(screen.getByText("Finalized")).toBeInTheDocument();
    expect(screen.queryByText("Accepting data")).not.toBeInTheDocument();
    expect(screen.queryByText("Not accepting data")).not.toBeInTheDocument();
  });

  it("shows Finalized rather than Accepting data on a legacy finalized experiment", () => {
    experimentDoc = { ...BASE_EXPERIMENT, active: true, finalized: true };
    renderWithChakra(<ExperimentPage />);

    expect(screen.getByText("Finalized")).toBeInTheDocument();
    expect(screen.queryByText("Accepting data")).not.toBeInTheDocument();
  });
});
