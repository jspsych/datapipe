import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

// Mock firebase since test env doesn't have NEXT_PUBLIC_FIREBASE_CONFIG.
// auth.currentUser mirrors a signed-in user with a working getIdToken().
const mockGetIdToken = jest.fn(() => Promise.resolve("id-token-123"));
jest.mock("../lib/firebase", () => ({
  auth: { currentUser: { uid: "user-1", getIdToken: () => mockGetIdToken() } },
  db: {},
}));

// Mock context to provide a signed-in user (this page is wrapped in AuthCheck).
jest.mock("../lib/context", () => ({
  UserContext: require("react").createContext({
    user: { uid: "user-1" },
    loading: false,
  }),
}));

// firebase/firestore's `doc` must not touch a real Firestore instance. The
// batch-write mocks that used to sit here (writeBatch/arrayUnion/setDoc) went
// with the client-side OSF creation path -- experiment documents are now
// written server-side by /api/createexperiment for every provider.
jest.mock("firebase/firestore", () => ({
  doc: jest.fn(() => ({})),
}));

// The page navigates via the `Router` singleton default export (see
// pages/admin/new.js: `import Router from "next/router"`), while AuthCheck
// uses the `useRouter()` hook. Mock both from the same module.
const mockPush = jest.fn();
jest.mock("next/router", () => ({
  __esModule: true,
  default: { push: (...args) => mockPush(...args) },
  useRouter: () => ({ push: mockPush, pathname: "/admin/new", query: {} }),
}));

jest.mock("react-firebase-hooks/firestore", () => ({
  useDocumentData: jest.fn(),
}));

// pickDriveFolder loads Google's Picker SDK from the network; stub it so the
// folder-selection flow is drivable in jsdom.
const mockPickDriveFolder = jest.fn();
jest.mock("../lib/google-picker", () => ({
  pickDriveFolder: (...args) => mockPickDriveFolder(...args),
}));

// Ark UI widgets (the provider RadioGroup here) measure their elements.
// jsdom ships no ResizeObserver, and a missing global there is a module-load
// crash rather than a test failure -- index.test.jsx carries the same guard
// for the landing page's Tabs.
if (typeof global.ResizeObserver === "undefined") {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import { useDocumentData } from "react-firebase-hooks/firestore";
import NewExperimentPage from "../pages/admin/new";

function renderPage() {
  return render(
    <ChakraProvider value={system}>
      <NewExperimentPage />
    </ChakraProvider>
  );
}

// Selecting a storage provider.
//
// The provider control is a Chakra/Ark `RadioGroup`, not the raw
// `<input type="radio">` this page used to render. Both expose the option's
// accessible name the same way -- the item is a `<label htmlFor>` pointing at
// a hidden radio input -- so `getByLabelText` still finds the right element
// and the assertions below are unchanged in intent.
//
// What DID change is the timing. A native radio ran React's `onChange`
// synchronously inside the click, so a plain `fireEvent.click` was followed by
// a fully re-rendered form. Ark routes the click through its own state machine
// (@zag-js/radio-group), which sends SET_VALUE, updates its bindable, and only
// then calls `onValueChange` -> `setProvider`. Asserting synchronously after
// the click can therefore observe the PREVIOUS provider's render.
//
// So this helper waits for the selection to actually land before returning.
// `data-state="checked"` on the item is the honest signal: zag derives it from
// `itemState.checked`, and because the group is controlled (`value={provider}`)
// that resolves to the page's own React state -- not merely to the DOM
// checkedness jsdom sets during click activation. If the page failed to update
// its provider, this wait fails, which is the correct outcome.
async function selectProvider(labelMatcher) {
  const input = screen.getByLabelText(labelMatcher);
  fireEvent.click(input);
  // The item IS the <label> wrapping the hidden input, and zag writes
  // data-state onto it. Reached via closest("label") rather than a data-part
  // selector so this does not depend on Ark's internal part naming.
  await waitFor(() =>
    expect(input.closest("label")).toHaveAttribute("data-state", "checked")
  );
}

const selectGoogleDrive = () => selectProvider(/Google Drive/i);
const selectDataverse = () => selectProvider(/^Dataverse$/i);

// Whether a provider's radio item is the one currently checked, without
// clicking it -- used to assert pre-selection (selectProvider above always
// clicks, which is exactly what pre-selection must NOT require).
function isProviderChecked(labelMatcher) {
  return (
    screen.getByLabelText(labelMatcher).closest("label").getAttribute("data-state") ===
    "checked"
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdToken.mockClear();
  mockGetIdToken.mockImplementation(() => Promise.resolve("id-token-123"));
  global.fetch = jest.fn();
});

// This block used to pin the OSF form as a regression guard. OSF is shutting
// down its projects feature, so the guarantee is now the opposite one: OSF
// must be unreachable from this page entirely. The assertions are inverted
// rather than deleted so a reintroduction gets caught.
describe("NewExperimentPage — OSF is closed to new experiments", () => {
  it("2. offers no OSF option and no OSF form, even for a researcher with a live OSF connection", () => {
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", refreshToken: "osf-refresh-token", usingPersonalToken: false },
      false,
      undefined,
    ]);

    renderPage();

    expect(screen.queryByLabelText(/^OSF$/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Existing OSF Project")).not.toBeInTheDocument();
    expect(
      screen.queryByText("New OSF Data Component Name")
    ).not.toBeInTheDocument();
    // The region picker was OSF-specific (its four options were OSF storage
    // regions), so it goes with the form.
    expect(screen.queryByText("Storage Location")).not.toBeInTheDocument();
  });

  it("2b. defaults to the first registered storage provider instead of OSF", () => {
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", connectedAccounts: { gdrive: true } },
      false,
      undefined,
    ]);

    renderPage();

    // gdrive is connected, so a gdrive default renders the create form. If
    // the page still defaulted to OSF this would show a connect CTA instead.
    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create experiment$/i })).toBeInTheDocument();
  });
});

describe("NewExperimentPage — Google Drive provider selector", () => {
  // NOTE ON INTERACTION MECHANICS: the spec allows a RadioGroup or a Select
  // for "Where should data be stored?". These assertions target the option
  // label text via getByLabelText, which works for either control as long
  // as the GREEN implementation gives the Google Drive option an
  // accessible name of "Google Drive" (radio input's associated label, or
  // an <option>/aria-label on a Select). See selectProvider above for why
  // the selection itself is awaited.

  it("3. selecting Google Drive with no connection shows a connect CTA, no title-only submit", async () => {
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        refreshToken: "osf-refresh-token",
        connectedAccounts: {},
      },
      false,
      undefined,
    ]);

    renderPage();
    await selectGoogleDrive();

    const cta = screen.getByRole("link", {
      name: /Connect Google Drive/i,
    });
    // The CTA now carries a return hint so account settings can offer a
    // "back to creating your experiment" affordance. The destination is
    // unchanged.
    expect(cta).toHaveAttribute("href", "/admin/account?next=/admin/new");
    expect(
      screen.queryByRole("button", { name: /^Create experiment$/i })
    ).not.toBeInTheDocument();
  });

  it("4. selecting Google Drive while connected shows only the title field + create button", async () => {
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        refreshToken: "osf-refresh-token",
        connectedAccounts: { gdrive: true },
      },
      false,
      undefined,
    ]);

    renderPage();
    await selectGoogleDrive();

    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create experiment$/i })).toBeInTheDocument();
    expect(
      screen.queryByText("Existing OSF Project")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("New OSF Data Component Name")
    ).not.toBeInTheDocument();
  });

  it("5. gdrive submit calls /api/createexperiment and navigates to /admin/<id> on success", async () => {
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        refreshToken: "osf-refresh-token",
        connectedAccounts: { gdrive: true },
      },
      false,
      undefined,
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, experimentID: "exp123" }),
    });

    renderPage();
    await selectGoogleDrive();

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "My Study" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create experiment$/i }));

    // Look up the createexperiment call by URL rather than assuming index 0:
    // selecting a connected provider also fires a background
    // /api/providersetupwarnings fetch (see pages/admin/new.js's
    // setup-warnings effect), which can land in the mock's call log before
    // this one.
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([callUrl]) => callUrl === "/api/createexperiment")
      ).toBe(true)
    );
    const [url, options] = global.fetch.mock.calls.find(
      ([callUrl]) => callUrl === "/api/createexperiment"
    );
    expect(url).toBe("/api/createexperiment");
    expect(JSON.parse(options.body)).toEqual({
      provider: "gdrive",
      title: "My Study",
      uid: "user-1",
      idToken: "id-token-123",
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/admin/exp123")
    );
  });

  it("6. gdrive submit failure renders an error message and does not navigate", async () => {
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        refreshToken: "osf-refresh-token",
        connectedAccounts: { gdrive: true },
      },
      false,
      undefined,
    ]);
    global.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Could not create Drive folder" }),
    });

    renderPage();
    await selectGoogleDrive();

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "My Study" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Create experiment$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Could not create Drive folder/i)
      ).toBeInTheDocument()
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("NewExperimentPage — Dataverse provider (provider-generic rendering)", () => {
  function fillDataverseFields({
    collectionAlias = "my-lab",
    authorName = "Smith, Jane",
    contactEmail = "jane@example.edu",
    description = "A study about things",
    subject = "Social Sciences",
  } = {}) {
    fireEvent.change(screen.getByLabelText(/Collection alias/i), {
      target: { value: collectionAlias },
    });
    fireEvent.change(screen.getByLabelText(/Author name/i), {
      target: { value: authorName },
    });
    fireEvent.change(screen.getByLabelText(/Contact email/i), {
      target: { value: contactEmail },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: description },
    });
    fireEvent.change(screen.getByLabelText(/Subject/i), {
      target: { value: subject },
    });
  }

  it("the provider selector offers Dataverse", () => {
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", refreshToken: "osf-refresh-token", connectedAccounts: {} },
      false,
      undefined,
    ]);

    renderPage();

    expect(screen.getByLabelText(/^Dataverse$/i)).toBeInTheDocument();
  });

  it("selecting Dataverse with no connection shows the connect CTA and no create form", async () => {
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", refreshToken: "osf-refresh-token", connectedAccounts: {} },
      false,
      undefined,
    ]);

    renderPage();
    await selectDataverse();

    const cta = screen.getByRole("link", {
      name: /Connect Dataverse/i,
    });
    // The CTA now carries a return hint so account settings can offer a
    // "back to creating your experiment" affordance. The destination is
    // unchanged.
    expect(cta).toHaveAttribute("href", "/admin/account?next=/admin/new");
    expect(
      screen.queryByRole("button", { name: /^Create experiment$/i })
    ).not.toBeInTheDocument();
  });

  it("selecting a CONNECTED Dataverse renders the declared fields alongside Title", async () => {
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true },
      },
      false,
      undefined,
    ]);

    renderPage();
    await selectDataverse();

    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Collection alias/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Author name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Contact email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Subject/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create experiment$/i })).toBeInTheDocument();
  });

  it("submitting with a required field blank does NOT call the API", async () => {
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true },
      },
      false,
      undefined,
    ]);

    renderPage();
    await selectDataverse();

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "My Dataverse Study" },
    });
    // Fill every declared field except the required authorName.
    fireEvent.change(screen.getByLabelText(/Collection alias/i), {
      target: { value: "my-lab" },
    });
    fireEvent.change(screen.getByLabelText(/Contact email/i), {
      target: { value: "jane@example.edu" },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: "A study about things" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Create experiment$/i }));

    // The page legitimately fetches /api/providersetupwarnings on provider
    // selection now -- the invariant is that no CREATE happens, not that
    // the network stays silent.
    const createCalls = global.fetch.mock.calls.filter(
      ([url]) => url === "/api/createexperiment"
    );
    expect(createCalls).toHaveLength(0);
  });

  it("a full submit calls /api/createexperiment with researcherInput carrying exactly the five declared fields, and navigates on success", async () => {
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true },
      },
      false,
      undefined,
    ]);
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, experimentID: "exp-dv-1" }),
    });

    renderPage();
    await selectDataverse();

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "My Dataverse Study" },
    });
    fillDataverseFields();

    fireEvent.click(screen.getByRole("button", { name: /^Create experiment$/i }));

    // Look up the createexperiment call by URL rather than assuming index 0
    // -- same reasoning as the gdrive submit test above.
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([callUrl]) => callUrl === "/api/createexperiment")
      ).toBe(true)
    );
    const [url, options] = global.fetch.mock.calls.find(
      ([callUrl]) => callUrl === "/api/createexperiment"
    );
    expect(url).toBe("/api/createexperiment");
    const body = JSON.parse(options.body);
    expect(body.provider).toBe("dataverse");
    expect(body.title).toBe("My Dataverse Study");
    expect(Object.keys(body.researcherInput).sort()).toEqual(
      ["authorName", "collectionAlias", "contactEmail", "description", "subject"].sort()
    );
    expect(body.researcherInput).toEqual({
      collectionAlias: "my-lab",
      authorName: "Smith, Jane",
      contactEmail: "jane@example.edu",
      description: "A study about things",
      subject: "Social Sciences",
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/admin/exp-dv-1")
    );
  });

  it("a picked Drive folder does not leak onto a Dataverse create", async () => {
    // Regression guard: selectedFolder is submitted as the top-level
    // parentFolderId, so it must be cleared when the provider changes --
    // otherwise a Drive folder id rides along on a Dataverse request.
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true, gdrive: true },
      },
      false,
      undefined,
    ]);
    global.fetch.mockImplementation((url) => {
      if (url.includes("/api/getprovideraccesstoken")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ accessToken: "drive-token" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ experimentId: "exp-no-leak" }),
      });
    });
    mockPickDriveFolder.mockResolvedValue({
      id: "leaky-folder-id",
      name: "leaky-folder",
    });

    renderPage();

    // Pick a Drive folder on the gdrive path.
    await selectGoogleDrive();
    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "Leak check" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Choose Drive folder/i }));
    await waitFor(() =>
      expect(screen.getByText("leaky-folder")).toBeInTheDocument()
    );

    // Switch to Dataverse and submit.
    await selectDataverse();
    fillDataverseFields();
    fireEvent.click(screen.getByRole("button", { name: /^Create experiment$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const createCall = global.fetch.mock.calls.find(([url]) =>
      url.includes("/api/createexperiment")
    );
    const body = JSON.parse(createCall[1].body);
    expect(body.provider).toBe("dataverse");
    expect(body.parentFolderId).toBeUndefined();
  });

  it("switching provider away and back clears the entered values (no stale carry-over)", async () => {
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true, gdrive: true },
      },
      false,
      undefined,
    ]);

    renderPage();
    await selectDataverse();
    // Types contactEmail "jane@example.edu" -- deliberately NOT the account's
    // "researcher@example.edu" above, so the assertions below can tell "the
    // typed value survived" apart from "the account seed came back".
    fillDataverseFields({ collectionAlias: "stale-lab" });

    expect(screen.getByLabelText(/Collection alias/i)).toHaveValue("stale-lab");

    await selectGoogleDrive();
    await selectDataverse();

    expect(screen.getByLabelText(/Collection alias/i)).toHaveValue("");
    expect(screen.getByLabelText(/Author name/i)).toHaveValue("");
    expect(screen.getByLabelText(/Description/i)).toHaveValue("");
    expect(screen.getByLabelText(/Subject/i)).toHaveValue("");
    // Contact email comes back to the ACCOUNT's address, not to empty and not
    // to what was typed. The guarantee this test exists for is that nothing
    // the researcher typed leaks across a provider switch, and that holds: the
    // typed "jane@example.edu" is gone. What replaces it is the same seed a
    // fresh load of the form would show, so clearing it to "" would make
    // switching provider twice a worse starting state than never touching it.
    expect(screen.getByLabelText(/Contact email/i)).toHaveValue(
      "researcher@example.edu"
    );
  });

  it("prefills contact email from the account, and lets a typed value override it", async () => {
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        refreshToken: "osf-refresh-token",
        connectedAccounts: { dataverse: true },
      },
      false,
      undefined,
    ]);

    renderPage();
    await selectDataverse();

    // users/{uid}.contactEmail is mandatory and gated by ContactEmailGate, so
    // it is always available here -- asking a researcher to retype it was pure
    // duplication. Every other Dataverse field has no account-level
    // counterpart yet and stays empty.
    expect(screen.getByLabelText(/Contact email/i)).toHaveValue(
      "researcher@example.edu"
    );
    expect(screen.getByLabelText(/Author name/i)).toHaveValue("");

    // A seed, never a lock: Dataverse publishes datasetContact on the dataset,
    // and the address a researcher wants public is not always the one DataPipe
    // emails them at.
    fireEvent.change(screen.getByLabelText(/Contact email/i), {
      target: { value: "lab-inbox@example.edu" },
    });
    expect(screen.getByLabelText(/Contact email/i)).toHaveValue(
      "lab-inbox@example.edu"
    );
  });
});

describe("NewExperimentPage — provider setup warnings (Dataverse)", () => {
  it("selecting a connected Dataverse shows a warning returned by /api/providersetupwarnings", async () => {
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", refreshToken: "osf-refresh-token", connectedAccounts: { dataverse: true } },
      false,
      undefined,
    ]);
    // Dispatch by URL, per the file's existing convention (see the
    // Google-Drive-folder-leak test above), rather than a blanket
    // mockResolvedValue -- this endpoint is called alongside others.
    global.fetch.mockImplementation((url) => {
      if (url.includes("/api/providersetupwarnings")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              warnings: [
                "This Dataverse installation reports version 5.10, which predates Dataverse 5.11.",
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    renderPage();
    await selectDataverse();

    await waitFor(() =>
      expect(screen.getByText(/predates Dataverse 5\.11/i)).toBeInTheDocument()
    );
  });

  it("an empty warnings array shows nothing", async () => {
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", refreshToken: "osf-refresh-token", connectedAccounts: { dataverse: true } },
      false,
      undefined,
    ]);
    global.fetch.mockImplementation((url) => {
      if (url.includes("/api/providersetupwarnings")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ warnings: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    renderPage();
    await selectDataverse();

    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([callUrl]) => callUrl.includes("/api/providersetupwarnings"))
      ).toBe(true)
    );

    expect(screen.queryByText(/predates Dataverse/i)).not.toBeInTheDocument();
    // The rest of the connected-provider form still renders normally.
    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
  });

  it("a failed warnings fetch is silent -- the form still renders and submission is not blocked", async () => {
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", refreshToken: "osf-refresh-token", connectedAccounts: { dataverse: true } },
      false,
      undefined,
    ]);
    global.fetch.mockImplementation((url) => {
      if (url.includes("/api/providersetupwarnings")) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, experimentID: "exp-warn-fail" }),
      });
    });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    renderPage();
    await selectDataverse();

    // Let the failed warnings fetch settle before interacting further.
    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([callUrl]) => callUrl.includes("/api/providersetupwarnings"))
      ).toBe(true)
    );

    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
    expect(screen.queryByText(/predates Dataverse/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Title$/i), {
      target: { value: "My Dataverse Study" },
    });
    fireEvent.change(screen.getByLabelText(/Collection alias/i), { target: { value: "my-lab" } });
    fireEvent.change(screen.getByLabelText(/Author name/i), { target: { value: "Smith, Jane" } });
    fireEvent.change(screen.getByLabelText(/Contact email/i), {
      target: { value: "jane@example.edu" },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: "A study about things" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Create experiment$/i }));

    await waitFor(() =>
      expect(
        global.fetch.mock.calls.some(([callUrl]) => callUrl === "/api/createexperiment")
      ).toBe(true)
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/admin/exp-warn-fail"));

    consoleErrorSpy.mockRestore();
  });
});

describe("NewExperimentPage — storage provider pre-selection", () => {
  it("pre-selects the sole connected provider, even though it is not the default (first) one", async () => {
    // dataverse is neither gdrive (the DEFAULT_PROVIDER / first registered
    // provider) nor connected alongside anything else -- if this passed
    // because of the old unconditional default, it would be gdrive selected
    // instead, and the Dataverse-only "Collection alias" field would not be
    // showing.
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", connectedAccounts: { dataverse: true } },
      false,
      undefined,
    ]);

    renderPage();

    await waitFor(() => expect(isProviderChecked(/^Dataverse$/i)).toBe(true));
    expect(screen.getByLabelText(/^Title$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Collection alias/i)).toBeInTheDocument();
  });

  it("pre-selects the first connected provider in left-to-right display order when several are connected", async () => {
    // Display order is gdrive, dataverse, zenodo (Object.values(STORAGE_
    // PROVIDERS) -- the same order the radios are rendered in). gdrive is
    // NOT connected here, so the first connected provider is dataverse, not
    // zenodo, even though both are connected.
    useDocumentData.mockReturnValue([
      {
        contactEmail: "researcher@example.edu",
        connectedAccounts: { zenodo: true, dataverse: true },
      },
      false,
      undefined,
    ]);

    renderPage();

    await waitFor(() => expect(isProviderChecked(/^Dataverse$/i)).toBe(true));
    expect(isProviderChecked(/^Zenodo$/i)).toBe(false);
    // Collection alias is declared only on Dataverse's containerInputFields,
    // so it renders exactly when Dataverse is the selected (not merely
    // connected) provider.
    expect(screen.getByLabelText(/Collection alias/i)).toBeInTheDocument();
  });

  it("leaves the default provider as-is when no provider is connected", async () => {
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", connectedAccounts: {} },
      false,
      undefined,
    ]);

    renderPage();

    // Nothing is connected, so there is nothing for the pre-selection rule to
    // prefer -- this is a no-op, leaving the pre-existing DEFAULT_PROVIDER
    // (gdrive, the first registered provider) selected, same as before this
    // feature existed.
    await waitFor(() => expect(isProviderChecked(/Google Drive/i)).toBe(true));
    expect(
      screen.getByRole("link", { name: /Connect Google Drive/i })
    ).toBeInTheDocument();
  });

  it("does not override a provider the researcher already picked once the account document updates again", async () => {
    // Nothing is connected yet -- the pre-selection effect is therefore a
    // no-op on mount, same as the "none connected" case above -- and the
    // account document carries a live Firestore subscription (see this
    // page's own comment on the `seededRef` effect), so it can, and later
    // does, emit again.
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", connectedAccounts: {} },
      false,
      undefined,
    ]);

    const { rerender } = renderPage();
    await selectDataverse();

    // The subscription now reports gdrive as connected -- gdrive being both
    // the sole connected provider AND first in display order is exactly the
    // combination the pre-selection rule would otherwise prefer. It must not
    // un-pick the researcher's own choice.
    //
    // Re-rendering the SAME element tree (rather than calling renderPage()
    // again) is what makes this a re-render of the existing component --
    // preserving its state and refs -- rather than a second component
    // mounted alongside the first, matching how a real onSnapshot update
    // reaches an already-mounted page.
    useDocumentData.mockReturnValue([
      { contactEmail: "researcher@example.edu", connectedAccounts: { gdrive: true } },
      false,
      undefined,
    ]);

    rerender(
      <ChakraProvider value={system}>
        <NewExperimentPage />
      </ChakraProvider>
    );

    await waitFor(() => expect(isProviderChecked(/^Dataverse$/i)).toBe(true));
    expect(isProviderChecked(/Google Drive/i)).toBe(false);
  });
});
