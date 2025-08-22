import { onRequest } from "firebase-functions/v2/https";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";

export const apiCondition = onRequest(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
    return;
  }

  // Set CORS headers for actual request
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  const { experimentID } = req.body;

  if (!experimentID) {
    res.status(400).json(MESSAGES.MISSING_PARAMETER);
    return;
  }

  await writeLog(experimentID, "getCondition");

  const exp_doc_ref = db.collection("experiments").doc(experimentID);
  const exp_doc = await exp_doc_ref.get();

  if (!exp_doc.exists) {
    res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
    return;
  }

  const exp_data = exp_doc.data();
  if (!exp_data.activeConditionAssignment) {
    res.status(400).json(MESSAGES.CONDITION_ASSIGNMENT_NOT_ACTIVE);
    return;
  }

  // if there is only 1 condition, just send 0
  if (exp_data.nConditions === 1) {
    res.status(200).json({ message: "Success", condition: 0 });
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
      t.set(exp_doc_ref, { currentCondition: nextCondition }, { merge: true });
      return currentCondition;
    });
  } catch (error) {
    res.status(400).json(MESSAGES.UNKNOWN_ERROR_GETTING_CONDITION);
    return;
  }

  res.status(200).json({ message: "Success", condition: condition });
  return;
});
