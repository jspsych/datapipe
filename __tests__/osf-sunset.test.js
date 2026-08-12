import {
  hasLegacyOsfConnection,
  isLegacyOsfExperiment,
  osfSunsetLabel,
  OSF_SUNSET_DATE,
} from "../lib/osf-sunset";

describe("isLegacyOsfExperiment", () => {
  it("is true for an explicit osf storageProvider", () => {
    expect(isLegacyOsfExperiment({ storageProvider: "osf" })).toBe(true);
  });

  it("is true when storageProvider is ABSENT", () => {
    // Experiments created before the provider-migration schema have no
    // storageProvider field and always meant OSF. This mirrors
    // getProviderForExperiment in functions/src/providers/index.ts, which
    // applies the same legacy default -- if the two ever disagree, the
    // banner would go missing on exactly the oldest experiments.
    expect(isLegacyOsfExperiment({ osfFilesLink: "https://osf.io/x/" })).toBe(
      true
    );
    expect(isLegacyOsfExperiment({})).toBe(true);
  });

  it("is false for every other provider", () => {
    for (const storageProvider of ["gdrive", "dataverse", "zenodo"]) {
      expect(isLegacyOsfExperiment({ storageProvider })).toBe(false);
    }
  });

  it("is false for no experiment at all", () => {
    expect(isLegacyOsfExperiment(null)).toBe(false);
    expect(isLegacyOsfExperiment(undefined)).toBe(false);
  });
});

describe("hasLegacyOsfConnection", () => {
  it("detects both routes a researcher could have connected OSF by", () => {
    // OAuth grant...
    expect(hasLegacyOsfConnection({ authMethod: "osf" })).toBe(true);
    expect(hasLegacyOsfConnection({ refreshToken: "rt" })).toBe(true);
    expect(hasLegacyOsfConnection({ osfUserId: "abc12" })).toBe(true);
    // ...and the pasted personal access token.
    expect(hasLegacyOsfConnection({ osfToken: "encrypted" })).toBe(true);
  });

  it("is false for an account that never touched OSF", () => {
    // A new researcher must never be shown the legacy OSF surfaces. Note the
    // empty-string fields: signup used to seed exactly these.
    expect(
      hasLegacyOsfConnection({
        uid: "u1",
        email: "a@b.edu",
        experiments: [],
        osfToken: "",
        refreshToken: "",
      })
    ).toBe(false);
    expect(hasLegacyOsfConnection({})).toBe(false);
    expect(hasLegacyOsfConnection(null)).toBe(false);
  });
});

describe("osfSunsetLabel", () => {
  it("is pinned to the announced cutoff", () => {
    expect(OSF_SUNSET_DATE).toBe("2026-11-16");
  });

  it("renders the announced date, and does NOT slip a day west of UTC", () => {
    const label = osfSunsetLabel();
    expect(label).toEqual(expect.any(String));
    expect(label).toContain("2026");
    // The day is the point of this assertion. "2026-11-16" parses as UTC
    // midnight, so formatting it in a negative-offset zone (any US timezone,
    // where most of DataPipe's researchers are) would render November 15 --
    // announcing a deadline one day earlier than the one agreed. osfSunsetLabel
    // formats with timeZone: "UTC" precisely to prevent that, and this pins it.
    expect(label).toContain("16");
    expect(label).not.toContain("15");
  });
});
