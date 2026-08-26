import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import ExperimentValidation from "../components/dashboard/ExperimentValidation";

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
  useValidation: true,
  allowJSON: true,
  allowCSV: true,
  requiredFields: ["trial_type"],
  ...overrides,
});

const focusFieldInput = async () => {
  const input = screen.getByRole("textbox");
  await act(async () => {
    input.focus();
  });
  return input;
};

const typeAndCommit = (input, text) => {
  fireEvent.input(input, {
    target: { value: text },
    inputType: "insertText",
  });
  fireEvent.keyDown(input, { key: "Enter" });
};

beforeEach(() => {
  setDocMock.mockClear();
});

describe("ExperimentValidation — required fields", () => {
  it("shows the stored list as pills", () => {
    renderWithChakra(
      <ExperimentValidation
        data={experiment({ requiredFields: ["trial_type", "rt"] })}
      />
    );
    expect(screen.getByText("trial_type")).toBeInTheDocument();
    expect(screen.getByText("rt")).toBeInTheDocument();
  });

  it("does not write on mount", async () => {
    renderWithChakra(<ExperimentValidation data={experiment()} />);
    await act(async () => {});
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it("saves the list when a field is added", async () => {
    renderWithChakra(<ExperimentValidation data={experiment()} />);

    typeAndCommit(await focusFieldInput(), "rt");

    await waitFor(() => expect(setDocMock).toHaveBeenCalledTimes(1));
    expect(setDocMock.mock.calls[0][1]).toEqual({
      allowJSON: true,
      allowCSV: true,
      requiredFields: ["trial_type", "rt"],
    });
  });

  it("saves the list when a field is removed", async () => {
    renderWithChakra(
      <ExperimentValidation
        data={experiment({ requiredFields: ["trial_type", "rt"] })}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /remove field trial_type/i })
    );

    await waitFor(() => expect(setDocMock).toHaveBeenCalledTimes(1));
    expect(setDocMock.mock.calls[0][1].requiredFields).toEqual(["rt"]);
  });

  it("saves the trimmed name, not what was typed", async () => {
    // The whole point. `" rt "` in the document is a field no submission has,
    // and the resulting 400 does not say so.
    renderWithChakra(
      <ExperimentValidation data={experiment({ requiredFields: [] })} />
    );

    typeAndCommit(await focusFieldInput(), "  rt  ");

    await waitFor(() => expect(setDocMock).toHaveBeenCalledTimes(1));
    expect(setDocMock.mock.calls[0][1].requiredFields).toEqual(["rt"]);
  });

  it("does not write when a duplicate is refused", async () => {
    renderWithChakra(<ExperimentValidation data={experiment()} />);

    typeAndCommit(await focusFieldInput(), "trial_type");
    await act(async () => {});

    expect(setDocMock).not.toHaveBeenCalled();
    expect(screen.getByText(/already in the list/i)).toBeInTheDocument();
  });

  it("draws no pill for a legacy [\"\"] document", () => {
    // Documents written by the old textarea can hold a single empty string. An
    // empty pill has nothing to draw, so it would be a chip the researcher can
    // neither see nor delete.
    const { container } = renderWithChakra(
      <ExperimentValidation data={experiment({ requiredFields: [""] })} />
    );
    expect(
      container.querySelectorAll("[data-part='item-preview']")
    ).toHaveLength(0);
  });

  it("reverts the list and explains when the write fails", async () => {
    setDocMock.mockImplementationOnce(() => Promise.reject(new Error("nope")));
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    renderWithChakra(<ExperimentValidation data={experiment()} />);

    typeAndCommit(await focusFieldInput(), "rt");

    await waitFor(() =>
      expect(screen.getByText(/could not save your validation rules/i))
        .toBeInTheDocument()
    );
    // The pill has to go with the message: a list that still shows `rt` while
    // Firestore does not hold it is the lie SettingsRow exists to prevent.
    expect(screen.queryByText("rt")).not.toBeInTheDocument();
    expect(screen.getByText("trial_type")).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("hides the required-fields control when validation is off", () => {
    renderWithChakra(
      <ExperimentValidation data={experiment({ useValidation: false })} />
    );
    expect(screen.queryByText("Required fields")).not.toBeInTheDocument();
  });
});
