import { onRequest } from "firebase-functions/v2/https";
import { DocumentReference, DocumentData, DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import MESSAGES from "./api-messages.js";
import { ExperimentData } from './interfaces';


export const apiCondition = onRequest({ cors: true }, async (req, res) => {
  const { experimentID } = req.body;

  if (!experimentID) {
    res.status(400).json(MESSAGES.MISSING_PARAMETER);
    return;
  }

  const exp_doc_ref: DocumentReference<DocumentData> = db.collection("experiments").doc(experimentID);
  const exp_doc: DocumentSnapshot = await exp_doc_ref.get();

  if (!exp_doc.exists) {
    res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
    await writeLog(experimentID, "logError", MESSAGES.EXPERIMENT_NOT_FOUND);
    return;
  }

  const exp_data: ExperimentData = exp_doc.data() as ExperimentData;

  if (!exp_data) {
    res.status(400).json(MESSAGES.EXPERIMENT_DATA_NOT_FOUND);
    await writeLog(experimentID, "logError", MESSAGES.EXPERIMENT_DATA_NOT_FOUND);
    return;
  }

  // Counted here, not before the read above: an experiment that does not
  // exist has no owner, so a log document keyed by a garbage ID is one no
  // researcher can ever read -- it only inflates the request count and hands
  // anyone who can POST a way to create documents. See write-log.ts.
  const logContext = { owner: exp_data.owner, storageProvider: exp_data.storageProvider };
  await writeLog(experimentID, "getCondition", undefined, logContext);

  if (!exp_data.activeConditionAssignment) {
    res.status(400).json(MESSAGES.CONDITION_ASSIGNMENT_NOT_ACTIVE);
    await writeLog(experimentID, "logError", MESSAGES.CONDITION_ASSIGNMENT_NOT_ACTIVE, logContext);
    return;
  }

  // if there is only 1 condition, just send 0
  if (exp_data.nConditions === 1) {
    res.status(200).json({ message: "Success", condition: 0 });
    return;
  }

  // use a transaction here because current SDK doesn't supply transformed result after a set operation.
  // this might change in the future because it seems to be supported in other versions of the SDK.
  let condition: number;
  try {
    condition = await db.runTransaction(async (t) => {
      const exp_doc = await t.get(exp_doc_ref);
      const exp_data: ExperimentData = exp_doc.data() as ExperimentData;
      const currentCondition = exp_data.currentCondition;
      const nextCondition = (currentCondition + 1) % exp_data.nConditions;
      t.set(exp_doc_ref, { currentCondition: nextCondition }, { merge: true });
      return currentCondition;
    });
  } catch (error) {
    res.status(400).json(MESSAGES.UNKNOWN_ERROR_GETTING_CONDITION);
    await writeLog(experimentID, "logError", MESSAGES.UNKNOWN_ERROR_GETTING_CONDITION, logContext);
    return;
  }

  res.status(200).json({ message: "Success", condition: condition });
  return;
});
