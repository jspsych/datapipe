import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

/**
 * When the experiment page says "N sessions in progress", and when it shows
 * the live-sessions panel.
 *
 * The rule under test is an honesty rule (PRODUCT.md principle 5): only an
 * experiment that streams can have sessions in progress, so only such an
 * experiment may be told "0 in progress". An experiment that submits once at
 * the end gets no line at all, rather than a reassuring zero it cannot back.
 *
 * Harness modelled on finalized-experiment.test.jsx, with one change: the
 * Firestore mock carries the collection name through query(), so the live
 * sessions listener can be told apart from the upload-queue listener.
 */

jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1", getIdToken: () => Promise.resolve("t") } },
  db: {},
}));

jest.mock("firebase/firestore", () => ({
  doc: jest.fn((_db, ...segments) => ({ path: segments.join("/") })),
  collection: jest.fn((_db, name) => ({ name })),
  query: jest.fn((col) => ({ collection: col.name })),
  where: jest.fn(() => ({})),
  orderBy: jest.fn(() => ({})),
  deleteDoc: jest.fn(() => Promise.resolve()),
  setDoc: jest.fn(() => Promise.resolve()),
}));

jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({ user: { uid: "user-1" }, loading: false }),
}));

jest.mock("next/router", () => ({
  __esModule: true,
  default: { push: jest.fn() },
  useRouter: () => ({ push: jest.fn(), pathname: "/admin", query: { experiment_id: "exp1" } }),
}));

const USER_DOC = { contactEmail: "researcher@example.edu" };
let experimentDoc;
let logsDoc;
let liveRows;
let liveError;

jest.mock("react-firebase-hooks/firestore", () => ({
  useDocumentData: (ref) => {
    if (!ref) return [undefined, false, undefined];
    if (ref.path?.startsWith("users/")) return [USER_DOC, false, undefined];
    if (ref.path?.startsWith("experiments/")) return [experimentDoc, false, undefined, { exists: () => true }];
    if (ref.path?.startsWith("logs/")) return [logsDoc, false, undefined];
    return [null, false, undefined];
  },
  useCollectionData: (ref) => {
    if (!ref) return [undefined, false, undefined];
    if (ref.collection === "liveSessions") {
      const snapshot = { docs: liveRows.map((r) => ({ id: r.id, data: () => r })) };
      return [liveRows, false, liveError, liveError ? undefined : snapshot];
    }
    return [[], false, undefined, { docs: [] }];
  },
}));

import ExperimentPage from "../pages/admin/[experiment_id]";

const EXPERIMENT = {
  id: "exp1",
  title: "Word learning study",
  owner: "user-1",
  active: true,
  activeBase64: false,
  activeConditionAssignment: false,
  nConditions: 1,
  maxSessions: 100,
  limitSessions: false,
  sessions: 42,
  storageProvider: "zenodo",
  useValidation: false,
  allowJSON: true,
  allowCSV: true,
  requiredFields: [],
  metadataActive: false,
};

const ts = (ms) => ({ toMillis: () => ms });
const liveRow = (id, minutesAgo) => ({
  id,
  experimentID: "exp1",
  owner: "user-1",
  state: "active",
  startedAt: ts(Date.now() - minutesAgo * 60_000),
  disconnectedAt: null,
  recoverAfter: null,
});

function renderPage() {
  return render(
    <ChakraProvider value={system}>
      <ExperimentPage />
    </ChakraProvider>
  );
}

beforeEach(() => {
  experimentDoc = { ...EXPERIMENT };
  logsDoc = null;
  liveRows = [];
  liveError = undefined;
});

describe("sessions in progress on the experiment page", () => {
  it("says nothing about sessions in progress for an experiment that does not stream", () => {
    logsDoc = { saveData: 42 };
    renderPage();

    expect(screen.getByText("42 completed sessions")).toBeInTheDocument();
    expect(screen.queryByText(/in\s+progress/)).not.toBeInTheDocument();
  });

  it("says 0 in progress for a streaming experiment with nobody mid-session", () => {
    logsDoc = { saveData: 42, startSession: 50 };
    renderPage();

    expect(screen.getByText(/^0 sessions in\s+progress$/)).toBeInTheDocument();
    expect(screen.queryByText("Sessions in progress")).not.toBeInTheDocument();
  });

  it("counts and lists the sessions in progress", () => {
    logsDoc = { startSession: 3 };
    liveRows = [liveRow("a", 12), liveRow("b", 3)];
    renderPage();

    expect(screen.getByText(/^2 sessions in\s+progress$/)).toBeInTheDocument();
    expect(screen.getByText("Sessions in progress")).toBeInTheDocument();
    expect(screen.getByText("12 min")).toBeInTheDocument();
  });

  it("uses the singular for one session", () => {
    logsDoc = { startSession: 1 };
    liveRows = [liveRow("a", 1)];
    renderPage();

    expect(screen.getByText(/^1 session in\s+progress$/)).toBeInTheDocument();
  });

  it("drops the zero once the experiment is finalized", () => {
    experimentDoc = { ...EXPERIMENT, active: false, finalized: true };
    logsDoc = { startSession: 50 };
    renderPage();

    expect(screen.queryByText(/in\s+progress/)).not.toBeInTheDocument();
  });

  it("drops the zero while data collection is switched off", () => {
    experimentDoc = { ...EXPERIMENT, active: false };
    logsDoc = { startSession: 50 };
    renderPage();

    expect(screen.queryByText(/in\s+progress/)).not.toBeInTheDocument();
  });

  it("says so when it cannot check, instead of showing an empty list", () => {
    // A refused or broken listener must not read as "nobody is mid-session".
    logsDoc = { startSession: 5 };
    liveError = new Error("permission-denied");
    renderPage();

    expect(
      screen.getByText("DataPipe could not check for sessions in progress.")
    ).toBeInTheDocument();
  });
});
