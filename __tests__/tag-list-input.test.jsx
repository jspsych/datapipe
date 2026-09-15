import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { useState } from "react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import TagListInput, {
  normalizeTag,
  normalizeList,
} from "../components/ui/TagListInput";

// These names are compared with `Array.includes` against JSON keys and CSV
// header cells (functions/src/validate-*.ts). The comparison is exact, the
// server trims nothing, and a rejected submission is a bare 400 that does not
// say which field failed. So every case below is a shape that used to be
// enterable and would have silently rejected every participant.
describe("normalizeTag", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeTag("  trial_type  ")).toBe("trial_type");
  });

  it("keeps whitespace inside a name", () => {
    // A JSON key may legally contain a space. Collapsing it would break a
    // list that was correct.
    expect(normalizeTag("  response time  ")).toBe("response time");
  });

  it("strips quotes pasted from source code", () => {
    expect(normalizeTag('"trial_type"')).toBe("trial_type");
    expect(normalizeTag("'rt'")).toBe("rt");
    expect(normalizeTag("`rt`")).toBe("rt");
  });

  it("strips curly quotes pasted from a document", () => {
    expect(normalizeTag("“trial_type”")).toBe("trial_type");
    expect(normalizeTag("‘rt’")).toBe("rt");
  });

  it("strips nested quoting", () => {
    expect(normalizeTag("'\"rt\"'")).toBe("rt");
  });

  it("leaves an unbalanced quote alone", () => {
    // A name that genuinely starts with a quote is absurd, but guessing is
    // worse than leaving it visible: the pill shows exactly what will be
    // compared, so the researcher can see it is wrong.
    expect(normalizeTag('"rt')).toBe('"rt');
  });

  it("returns empty for whitespace and for non-strings", () => {
    expect(normalizeTag("   ")).toBe("");
    expect(normalizeTag("")).toBe("");
    expect(normalizeTag(undefined)).toBe("");
    expect(normalizeTag(null)).toBe("");
    expect(normalizeTag(7)).toBe("");
  });
});

describe("normalizeList", () => {
  it("drops the empty entry a trailing comma leaves behind", () => {
    // This is the `[""]` that reached live experiment documents and made both
    // validators reject every submission until they were taught to filter it.
    expect(normalizeList(["trial_type", ""])).toEqual(["trial_type"]);
    expect(normalizeList([""])).toEqual([]);
  });

  it("drops duplicates, keeping first position", () => {
    expect(normalizeList(["rt", "trial_type", "rt"])).toEqual([
      "rt",
      "trial_type",
    ]);
  });

  it("treats values that normalize alike as duplicates", () => {
    expect(normalizeList(["rt", ' "rt" '])).toEqual(["rt"]);
  });

  it("tolerates a missing list", () => {
    expect(normalizeList(undefined)).toEqual([]);
    expect(normalizeList(null)).toEqual([]);
  });
});

function Harness({ initial = [], onChange = () => {}, ...rest }) {
  const [value, setValue] = useState(initial);
  return (
    <ChakraProvider value={system}>
      <TagListInput
        label="Required fields"
        itemNoun="field"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        helperText="Every submission must contain all of these."
        {...rest}
      />
    </ChakraProvider>
  );
}

// The machine only handles input and key events while it is in its
// `focused:input` state, so every interaction focuses the field first, exactly
// as a researcher's would. Two details this has to get right or every
// interaction silently does nothing:
//
//   `input.focus()`, not `fireEvent.focus` -- React delegates `onFocus` from
//   the bubbling `focusin`, which a synthetic non-bubbling `focus` never
//   produces; and
//
//   the await -- the machine's FOCUS transition is queued in a microtask, so
//   anything typed in the same synchronous turn arrives while it is still
//   `idle` and is dropped.
const focusInput = async () => {
  const input = screen.getByRole("textbox");
  await act(async () => {
    input.focus();
  });
  return input;
};

// The machine listens on `onInput`, not `onChange`, and reads `inputType` off
// the native event to tell a paste from a keystroke.
const typeInto = (input, text, inputType = "insertText") => {
  fireEvent.input(input, { target: { value: text }, inputType });
};

const typeAndCommit = (input, text) => {
  typeInto(input, text);
  fireEvent.keyDown(input, { key: "Enter" });
};

// Committing with the delimiter is not a keydown: the machine sees a comma at
// the END of the input's value and commits whatever it had recorded before it.
// So the comma has to arrive as its own event, the way a real keystroke does --
// send "rt," in one go and the machine commits the empty string it still holds.
const typeWithComma = (input, text) => {
  typeInto(input, text);
  typeInto(input, `${text},`);
};

// A paste is the same `input` event carrying `inputType: "insertFromPaste"`,
// which is the only thing that tells the machine to split on the delimiter.
const pasteInto = (input, text) => {
  typeInto(input, text, "insertFromPaste");
};

describe("TagListInput", () => {
  it("renders one pill per committed value", () => {
    render(<Harness initial={["trial_type", "rt"]} />);
    expect(screen.getByText("trial_type")).toBeInTheDocument();
    expect(screen.getByText("rt")).toBeInTheDocument();
  });

  it("turns a typed name into a pill on Enter", async () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    typeAndCommit(await focusInput(), "trial_type");

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["trial_type"]));
    expect(screen.getByText("trial_type")).toBeInTheDocument();
  });

  it("trims before it commits, so the pill is what the server compares", async () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    typeAndCommit(await focusInput(), "  trial_type  ");

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["trial_type"]));
  });

  it("strips quotes pasted around a name", async () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    typeAndCommit(await focusInput(), '"trial_type"');

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["trial_type"]));
  });

  it("refuses a duplicate and says which name it was", async () => {
    const onChange = jest.fn();
    render(<Harness initial={["trial_type"]} onChange={onChange} />);

    typeAndCommit(await focusInput(), "trial_type");

    await waitFor(() =>
      expect(screen.getByText(/already in the list/i)).toBeInTheDocument()
    );
    // Rejected, not silently swallowed into a no-op write.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("never commits a whitespace-only entry", async () => {
    // The `[""]` that reached live documents came in through a trailing comma
    // in the old textarea. There is no route to it here: the machine refuses
    // to add from an empty-after-trim input, and `normalizeList` would drop it
    // even if one got through.
    const onChange = jest.fn();
    const { container } = render(<Harness onChange={onChange} />);

    typeAndCommit(await focusInput(), "   ");
    await act(async () => {});

    expect(onChange).not.toHaveBeenCalled();
    expect(
      container.querySelectorAll("[data-part='item-preview']")
    ).toHaveLength(0);
  });

  it("replaces the helper text with the notice rather than adding a line", async () => {
    render(<Harness initial={["rt"]} />);
    expect(
      screen.getByText("Every submission must contain all of these.")
    ).toBeInTheDocument();

    typeAndCommit(await focusInput(), "rt");

    await waitFor(() =>
      expect(screen.getByText(/already in the list/i)).toBeInTheDocument()
    );
    expect(
      screen.queryByText("Every submission must contain all of these.")
    ).not.toBeInTheDocument();
  });

  it("commits on comma as well as Enter", async () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    typeWithComma(await focusInput(), "rt");

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["rt"]));
  });

  it("splits a pasted comma-separated list into separate pills", async () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    pasteInto(await focusInput(), "trial_type, rt, subject_id");

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(["trial_type", "rt", "subject_id"])
    );
  });

  it("drops the empty a pasted trailing comma leaves behind", async () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    pasteInto(await focusInput(), "trial_type, rt,");

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(["trial_type", "rt"])
    );
    expect(onChange).not.toHaveBeenCalledWith(["trial_type", "rt", ""]);
  });

  it("commits a half-typed name when the researcher clicks away", async () => {
    // `blurBehavior="add"`. The old textarea parsed on blur, so a name typed
    // and abandoned still counted; dropping it here would be a regression, and
    // a silent one -- the field would simply be missing next time they looked.
    // The machine takes this from interact-outside, not from the input's own
    // blur, so the test has to leave the control the way a person does.
    const onChange = jest.fn();
    render(
      <>
        <Harness onChange={onChange} />
        <button type="button">elsewhere</button>
      </>
    );

    typeInto(await focusInput(), "subject_id");
    await act(async () => {
      // `focusin`, not a synthetic pointerdown: interact-outside only treats a
      // pointerdown as an interaction once the matching `click` arrives, and
      // it arms its pointer listeners on a timer. Moving focus out is the
      // route it handles immediately, and it is what Tab does anyway.
      screen.getByRole("button", { name: "elsewhere" }).focus();
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["subject_id"]));
  });

  it("gives every remove button a name that says what it removes", () => {
    render(<Harness initial={["trial_type", "rt"]} />);
    expect(
      screen.getByRole("button", { name: /remove field trial_type/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove field rt/i })
    ).toBeInTheDocument();
  });

  it("removes a pill when its button is pressed", async () => {
    const onChange = jest.fn();
    render(<Harness initial={["trial_type", "rt"]} onChange={onChange} />);

    fireEvent.click(
      screen.getByRole("button", { name: /remove field trial_type/i })
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["rt"]));
  });

  it("normalizes a list handed to it, so a legacy [\"\"] draws no pill", () => {
    const { container } = render(<Harness initial={["trial_type", ""]} />);
    expect(
      container.querySelectorAll("[data-part='item-preview']")
    ).toHaveLength(1);
  });
});
