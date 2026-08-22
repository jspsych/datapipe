import { render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../lib/theme";
import "@testing-library/jest-dom";

import ExperimentInfo from "../components/dashboard/ExperimentInfo";

function renderInfo(data) {
  return render(
    <ChakraProvider value={system}>
      <ExperimentInfo data={data} />
    </ChakraProvider>
  );
}

describe("ExperimentInfo — legacy OSF experiments (pinned regression)", () => {
  it("12. renders OSF Project and OSF Data Component links for legacy experiments", () => {
    renderInfo({
      id: "exp1",
      osfRepo: "abc12",
      osfComponent: "def34",
      sessions: 3,
    });

    // Sentence case per DESIGN.md §3 -- these labels were "OSF Project" and
    // "OSF Data Component" before the dashboard conversion.
    expect(screen.getByText("OSF project")).toBeInTheDocument();
    expect(screen.getByText("OSF data component")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /abc12/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /def34/ })).toBeInTheDocument();
  });
});

describe("ExperimentInfo — provider-aware rendering", () => {
  it("13. renders Google Drive Folder link for gdrive experiments; OSF labels are absent", () => {
    renderInfo({
      id: "exp2",
      storageProvider: "gdrive",
      providerContainer: { folderId: "folder123" },
      sessions: 5,
    });

    expect(screen.getByText("Google Drive Folder")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Open folder/ });
    expect(link).toHaveAttribute(
      "href",
      "https://drive.google.com/drive/folders/folder123"
    );

    expect(screen.queryByText("OSF project")).not.toBeInTheDocument();
    expect(screen.queryByText("OSF data component")).not.toBeInTheDocument();
  });
});
