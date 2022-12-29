import functions from "firebase-functions";
import cors from "cors";
import putFileOSF from "./put-file-osf.js";
import { db } from "./app.js";

const corsHandler = cors({ origin: true });

export const apiBase64 = functions.https.onRequest(async (req, res) => {
  corsHandler(req, res, async () => {
    const { experimentID, data, filename } = req.body;

    if (!experimentID) {
      res.status(400).send("Missing parameter experimentID");
      return;
    }
    if (!data) {
      res.status(400).send("Missing parameter data");
      return;
    }
    if (!filename) {
      res.status(400).send("Missing parameter filename");
      return;
    }

    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    const exp_doc = await exp_doc_ref.get();

    if (!exp_doc.exists) {
      res.status(400).send("Experiment does not exist");
      return;
    }

    const exp_data = exp_doc.data();
    if (!exp_data.activeBase64) {
      res
        .status(400)
        .send("Base64 data collection is not active for this experiment");
      return;
    }

    let buffer;
    try {
      buffer = Buffer.from(data, "base64");
    } catch (e) {
      res.status(400).send("Invalid base64 data");
      return;
    }

    const user_doc = await db.doc(`users/${exp_data.owner}`).get();
    if (!user_doc.exists) {
      res.status(400).send("This experiment has an invalid owner ID");
      return;
    }

    const user_data = user_doc.data();
    if (!user_data.osfToken) {
      res.status(400).send("This experiment does not have a valid OSF token");
      return;
    }

    const result = await putFileOSF(
      exp_data.osfFilesLink,
      user_data.osfToken,
      buffer,
      filename
    );

    if (!result.success) {
      if (result.errorCode === 409 && result.errorText === "Conflict") {
        res
          .status(400)
          .send("Error uploading file to OSF: File already exists");
      } else {
        res.status(400).send("Error uploading file to OSF");
      }
      return;
    }

    res.status(201).send(`Success`);
  });
});
