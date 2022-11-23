import functions from "firebase-functions";
import cors from "cors";
import { db } from "./app.js";

const corsHandler = cors({ origin: true });

export const apiCondition = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const { experimentID } = req.body;

      if (!experimentID) {
        res.status(400).send("Missing parameter experimentID");
        return;
      }
    } catch (error) {
      functions.logger.error(error);
      res.status(500).send(error);
    }

    let exp_doc_ref;
    let exp_doc;
    try {
      exp_doc_ref = db.collection("experiments").doc(experimentID);
      exp_doc = await exp_doc_ref.get();
    } catch (error) {
      res.status(400).send("Experiment does not exist");
      return;
    }

    if (!exp_doc.exists()) {
      res.status(400).send("Experiment does not exist");
      return;
    }

    const exp_data = exp_doc.data();
    if (!exp_data.active) {
      res.status(400).send("Experiment is not active");
      return;
    }

    // if there is only 1 condition, just send 0
    if (exp_data.nConditions === 1) {
      res.status(200).send("0");
      return;
    }

    // use a transaction here because current SDK doesn't supply transformed result after a set operation.
    // this might change in the future because it seems to be supported in other versions of the SDK.
    let condition;
    try {
      condition = await db.runTransaction(async (t) => {
        const exp_doc = await t.get(exp_doc_ref);
        const exp_data = exp_doc.data();
        const currentCondition = exp_data.currentCondition;
        const nextCondition = (currentCondition + 1) % exp_data.nConditions;
        t.set(
          exp_doc_ref,
          { currentCondition: nextCondition },
          { merge: true }
        );
        return currentCondition;
      });
    } catch (error) {
      res.status(400).send("Error getting condition");
      return;
    }

    res.status(200).send(condition.toString());
    return;
  });
});
