import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import MetadataControl from "../components/dashboard/MetadataControl";

// The component writes straight to Firestore on change; stub the SDK so the
// only thing under test is whether it OFFERS the write.
const setDocMock = jest.fn(() => Promise.resolve());
jest.mock("firebase/firestore", () => ({
  setDoc: (...args) => setDocMock(...args),
  doc: jest.fn(() => ({})),
}));
jest.mock("../lib/firebase", () => ({ db: {} }));

function renderWithChakra(ui) {
  return render(<ChakraProvider value={system}>{ui}</ChakraProvider>);
}

const experiment = (overrides = {}) => ({
  id: "exp-1",
  metadataActive: false,
  sessions: 0,
  ...overrides,
});

beforeEach(() => {
  setDocMock.mockClear();
});

// Psych-DS metadata decides WHERE a submission is stored (container root vs
// data/raw/) and which namespace the duplicate-detection cache claims in, so
// it freezes at the first submission. firestore.rules is the real gate; these
// cover what the dashboard offers, which is what stops a researcher hitting a
// refusal they were given no warning about.
describe("MetadataControl — before any data is collected", () => {
  it("leaves the switch operable and saves a change", async () => {
    renderWithChakra(<MetadataControl data={experiment()} />);

    const toggle = screen.getByRole("checkbox");
    expect(toggle).toBeEnabled();

    fireEvent.click(toggle);
    await waitFor(() => expect(setDocMock).toHaveBeenCalledTimes(1));
    expect(setDocMock.mock.calls[0][1]).toEqual({ metadataActive: true });
  });

  it("shows no lock explanation", () => {
    renderWithChakra(<MetadataControl data={experiment()} />);
    expect(screen.queryByText(/Locked because/i)).not.toBeInTheDocument();
  });
});

describe("MetadataControl — once data has been collected", () => {
  it("disables the switch when sessions have been recorded", () => {
    renderWithChakra(<MetadataControl data={experiment({ sessions: 4 })} />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  // collisionCache is server-managed and clients cannot write it, so it still
  // reports "this experiment has data" if the sessions counter reads 0.
  it("disables the switch when only collisionCache reports data", () => {
    renderWithChakra(
      <MetadataControl data={experiment({ sessions: 0, collisionCache: { salt: "s" } })} />
    );
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("explains WHY it is locked rather than just appearing broken", () => {
    renderWithChakra(<MetadataControl data={experiment({ sessions: 4 })} />);
    expect(screen.getByText(/Locked because this experiment has collected data/i)).toBeInTheDocument();
  });

  // The write is the observable contract, and it is what the server rule
  // would refuse. Deliberately NOT asserting the input's `checked` state:
  // jsdom flips a disabled checkbox's raw DOM state for a synthetically
  // dispatched click, so that assertion would be measuring jsdom rather than
  // this component -- React state never changes, and no write is issued.
  it("never issues a write, even if the switch is activated directly", async () => {
    renderWithChakra(<MetadataControl data={experiment({ sessions: 4 })} />);
    const toggle = screen.getByRole("checkbox");

    fireEvent.click(toggle);

    expect(setDocMock).not.toHaveBeenCalled();
    expect(toggle).toBeDisabled();
  });
});
