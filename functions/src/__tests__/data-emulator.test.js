/**
 * @jest-environment node
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import MESSAGES from "../api-messages";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

async function saveData(body) {
  const response = await fetch(
    "http://localhost:5001/datapipe-test/us-central1/apidata",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body: JSON.stringify(body),
    }
  );
  const message = await response.json();
  return message;
}

const config = {
  projectId: "datapipe-test",
};

jest.setTimeout(30000);


beforeAll(async () => {
  initializeApp(config);
  const db = getFirestore();
  await db.collection("experiments").doc("data-testexp").set({ active: false });
  await db.collection("users").doc("testuser").set({
    osfTokenValid: false,
    usingPersonalToken: true,
  });
  await db.collection("experiments").doc("data-testexp-active-no-owner").set({
    active: true,
  });
  await db.collection("experiments").doc("data-testexp-active").set({
    active: true,
    owner: "testuser",
  });
  // `testlog` used to be deliberately absent: the request counter was
  // incremented before api-data.ts checked that the experiment existed, so a
  // log document appeared for any ID at all. It is counted after the check
  // now (see write-log.ts), so the experiment this test counts against has to
  // actually exist.
  await db.collection("experiments").doc("testlog").set({
    active: false,
    owner: "testuser",
    storageProvider: "osf",
  });
});

describe("apiData", () => {
  it("should return error message when there is no experimentID in the body", async () => {
    const response = await saveData({});
    expect(response).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("should return error message when there is no data in the body", async () => {
    const response = await saveData({ experimentID: "data-test" });
    expect(response).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("should return error message when there is no filename in the body", async () => {
    const response = await saveData({ experimentID: "data-test", data: "test" });
    expect(response).toEqual(MESSAGES.MISSING_PARAMETER);
  });

  it("should increment the write request log for the experiment when there is a complete request", async () => {
    const db = getFirestore();
    await db.collection("logs").doc("testlog").delete();
    // writeLog is awaited inside apiData before the response is sent,
    // so the log document should exist by the time we get the response.
    await saveData({
      experimentID: "testlog",
      data: "test",
      filename: "test",
    });
    // Small delay to allow Firestore emulator to sync
    await new Promise((resolve) => setTimeout(resolve, 500));
    let doc = await db.collection("logs").doc("testlog").get();
    expect(doc.exists).toBe(true);
    expect(doc.data().saveData).toBe(1);
    // The two fields that make this document readable by its owner
    // (firestore.rules) and groupable by provider.
    expect(doc.data().owner).toBe("testuser");
    expect(doc.data().storageProvider).toBe("osf");
    expect(doc.data().lastRequestAt).toBeTruthy();

    await saveData({
      experimentID: "testlog",
      data: "test",
      filename: "test",
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    doc = await db.collection("logs").doc("testlog").get();
    expect(doc.data().saveData).toBe(2);
  });

  it("should increment the error log for an experiment when errors are caught", async () => {
    const db = getFirestore();

    await db.collection("logs").doc("data-testexp").delete();

    await saveData({
      experimentID: "data-testexp",
      data: "test",
      filename: "test",
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    let doc = await db.collection("logs").doc("data-testexp").get();
    expect(doc.exists).toBe(true);
    expect(doc.data().logError).toBe(1);

    await db.collection("experiments").doc("data-testexp").set(
      {
        limitSessions: true,
        sessions: 2,
        maxSessions: 2,
      },
      { merge: true }
    );

    await saveData({
      experimentID: "data-testexp",
      data: "test",
      filename: "test",
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    doc = await db.collection("logs").doc("data-testexp").get();
    expect(doc.data().logError).toBe(2);

  });

  it("should not count a request against an experiment that does not exist", async () => {
    const db = getFirestore();
    const bogusID = `does-not-exist-${Date.now()}`;

    await saveData({ experimentID: bogusID, data: "test", filename: "test" });
    await new Promise((resolve) => setTimeout(resolve, 500));

    // The error is still recorded -- but `saveData`, the attempt counter, is
    // not touched, because there is no experiment for the attempt to be an
    // attempt AT. Counting it inflated the request totals and let any POST
    // create an unreadable, ownerless document.
    const doc = await db.collection("logs").doc(bogusID).get();
    expect(doc.data()?.saveData).toBeUndefined();
    expect(doc.data()?.owner).toBeUndefined();

    await db.collection("logs").doc(bogusID).delete();
  });

  it("should tally errors by code and stamp each entry with a real Timestamp", async () => {
    const db = getFirestore();
    await db.collection("logs").doc("data-testexp-bycode").delete();
    await db.collection("experiments").doc("data-testexp-bycode").set({
      active: false,
      owner: "testuser",
      storageProvider: "osf",
    });

    // Two of the same code, so the tally has to count rather than merely
    // record that the code was seen.
    await saveData({ experimentID: "data-testexp-bycode", data: "test", filename: "test" });
    await saveData({ experimentID: "data-testexp-bycode", data: "test", filename: "test" });
    await new Promise((resolve) => setTimeout(resolve, 700));

    const doc = await db.collection("logs").doc("data-testexp-bycode").get();
    const data = doc.data();

    expect(data.logError).toBe(2);
    expect(data.errorsByCode.DATA_COLLECTION_NOT_ACTIVE).toBe(2);

    // A real Timestamp, not the preformatted en-GB string it used to be --
    // the whole point is that this is sortable and filterable.
    expect(data.errors).toHaveLength(2);
    expect(typeof data.errors[0].time.toDate).toBe("function");
    expect(data.errors[0].time.toDate()).toBeInstanceOf(Date);

    // Both halves of what used to be two non-atomic writes land together.
    expect(data.owner).toBe("testuser");
    expect(data.storageProvider).toBe("osf");
  });

  it("should cap the stored errors array while the counter keeps climbing", async () => {
    const db = getFirestore();
    const experimentID = "data-testexp-cap";
    await db.collection("logs").doc(experimentID).delete();
    await db.collection("experiments").doc(experimentID).set({
      active: false,
      owner: "testuser",
      storageProvider: "osf",
    });

    // Seed the array one short of the cap with entries that are individually
    // identifiable, so the trim can be shown to drop the OLDEST rather than
    // some arbitrary slice. Driving 50 real requests through the emulator
    // would make this test minutes long for no extra coverage.
    const seeded = Array.from({ length: 49 }, (_, i) => ({
      error: "SEEDED",
      message: `seeded ${i}`,
      time: new Date(2020, 0, 1, 0, 0, i),
    }));
    await db.collection("logs").doc(experimentID).set({ errors: seeded }, { merge: true });

    // Two more real errors: the first fills the cap, the second must evict.
    await saveData({ experimentID, data: "test", filename: "test" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    let data = (await db.collection("logs").doc(experimentID).get()).data();
    expect(data.errors).toHaveLength(50);
    expect(data.errors[0].message).toBe("seeded 0");

    await saveData({ experimentID, data: "test", filename: "test" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    data = (await db.collection("logs").doc(experimentID).get()).data();

    // Still 50 -- the array does not grow past the cap ...
    expect(data.errors).toHaveLength(50);
    // ... the oldest entry is the one that went ...
    expect(data.errors[0].message).toBe("seeded 1");
    // ... the newest is at the tail, where the dashboard looks for it ...
    expect(data.errors[49].error).toBe("DATA_COLLECTION_NOT_ACTIVE");
    // ... and the true total is the counter, which is NOT capped. This is why
    // ErrorPanel is passed logError instead of errors.length.
    expect(data.logError).toBe(2);
  });

  it("should return error message when the experimentID does not match an experiment", async () => {
    const response = await saveData({
      experimentID: "doesnotexist",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.EXPERIMENT_NOT_FOUND);
  });

  it("should return error message when data collection is not active", async () => {
    const response = await saveData({
      experimentID: "data-testexp",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.DATA_COLLECTION_NOT_ACTIVE);
  });

  it("should return error message when the experiment has reached its session limit", async () => {
    const db = getFirestore();
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        limitSessions: true,
        sessions: 2,
        maxSessions: 2,
      },
      { merge: true }
    );
    const response = await saveData({
      experimentID: "data-testexp-active",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.SESSION_LIMIT_REACHED);
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        limitSessions: false,
      },
      { merge: true }
    );
  });

  it("should reject invalid JSON data when validation is on", async () => {
    const db = getFirestore();
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        useValidation: true,
        allowJSON: true,
        allowCSV: false,
      },
      { merge: true }
    );
    const response = await saveData({
      experimentID: "data-testexp-active",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_DATA);
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        useValidation: false,
      },
      { merge: true }
    );
  });

  it("should reject invalid CSV data when validation is on", async () => {
    const db = getFirestore();
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        useValidation: true,
        allowJSON: false,
        allowCSV: true,
      },
      { merge: true }
    );
    const response = await saveData({
      experimentID: "data-testexp-active",
      data: "foo, bar, quz\nfoo, bar", // previously "test" was throwing an error not because it was invalid CSV but because the requiredFields was undefined.
      // Now validate CSV checks for row length uniformity, and can work without requiredFields, so this error is thrown because of the former reason.
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_DATA);
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        useValidation: false,
      },
      { merge: true }
    );
  });

  it("should reject a request when there is no corresponding user", async () => {
    const response = await saveData({
      experimentID: "data-testexp-active-no-owner",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_OWNER);
  });

  it("should reject a request when there is no valid OSF token", async () => {
    const db = getFirestore();
    await db.collection("experiments").doc("data-testexp-active").set(
      {
        useValidation: false,
      },
      { merge: true }
    );
    const response = await saveData({
      experimentID: "data-testexp-active",
      data: "test",
      filename: "test",
    });
    expect(response).toEqual(MESSAGES.INVALID_OSF_TOKEN);
  });
});
