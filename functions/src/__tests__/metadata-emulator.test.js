/**
 * @jest-environment node
 */
import { startServer } from '../../lib/mock-server.js'
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import MESSAGES from '../../lib/api-messages.js';

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

const config = {
  projectId: "datapipe-test",
};

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

const sampleData = `[{
  "trial_type": "html-keyboard-response",
  "trial_index": 1,
  "time_elapsed": 776
}]`

let mockServerInstance;

beforeAll(async () => {

  mockServerInstance = startServer() 

  initializeApp(config);
  const db = getFirestore();

  await db.collection("experiments").doc('testexp').set({active: true, metadataActive: true, owner: 'test-user', osfFilesLink: "http://localhost:3000/endpoint"});
  await db.collection('users').doc('test-user').set({osfTokenValid: true, osfToken: 'valid'});
  await db.collection("metadata").doc('testexp').set({});
});

afterAll(async () => {
  mockServerInstance.close();
  console.log('Server closed');
});

describe('runTransaction', () => {

  it('should handle the case when metadata is present in OSF but not in firestore', async () => {

    const response = await saveData({
      experimentID: "testexp",
      data: sampleData,
      filename: "test",
    });

    expect(response.metadataMessage).toEqual(MESSAGES.METADATA_IN_OSF_NOT_IN_FIRESTORE.metadataMessage);
  });

  it('should handle the case when metadata is neither in firestore nor OSF', async () => {

    const db = getFirestore();
    await db.collection("users").doc("test-user").set({osfToken: 'invalid'}, {merge: true});

    await db.collection("experiments").doc("testexp").get()
    await db.collection("users").doc('test-user').get()
    await db.collection("metadata").doc("testexp").get()

    const response = await saveData({
      experimentID: "testexp",
      data: sampleData,
      filename: "test",
    });

    console.log(response);

   // console.log(response);

    expect(response.metadataMessage).toEqual(MESSAGES.METADATA_NOT_IN_FIRESTORE_OR_OSF.metadataMessage);
  });
  it('should handle the case when metadata is in OSF and in firestore', async () => {

    const db = getFirestore();
    await db.collection("users").doc("test-user").set({osfToken: 'valid'}, {merge: true});
    await db.collection("metadata").doc("testexp").set({metadata: "test-metadata"}, {merge: true});


    // Call your function
    const response = await saveData({
      experimentID: "testexp",
      data: sampleData,
      filename: "test",
    });

   // console.log(response);

    expect(response.metadataMessage).toEqual(MESSAGES.METADATA_IN_OSF_AND_FIRESTORE.metadataMessage);
  });
  it('should handle the case when metadata is not in OSF but is in firestore', async () => {

    const db = getFirestore();
    await db.collection("users").doc("test-user").set({osfToken: 'invalid'}, {merge: true});
    await db.collection("metadata").doc("testexp").set({metadata: "test-metadata"}, {merge: true})

    const response = await saveData({
      experimentID: "testexp",
      data: sampleData,
      filename: "test",
    });

   // console.log(response);

    expect(response.metadataMessage).toEqual(MESSAGES.METADATA_IN_FIRESTORE_NOT_IN_OSF.metadataMessage);
  });

});

