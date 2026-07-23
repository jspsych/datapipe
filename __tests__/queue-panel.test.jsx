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
];

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
  });
});
