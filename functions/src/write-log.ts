import { db } from "./app.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export default async function writeLog(experimentID: string, action: "saveData" | "saveBase64Data" | "getCondition" | "getSession" | "logError", error? : object) {
  try {
    const log_doc_ref = db.collection("logs").doc(experimentID);
    if (action === "saveData") {
      await log_doc_ref.set(
        { saveData: FieldValue.increment(1) },
        { merge: true }
      );
    }
    if (action === "saveBase64Data") {
      await log_doc_ref.set(
        { saveBase64Data: FieldValue.increment(1) },
        { merge: true }
      );
    }
    if (action === "getCondition") {
      await log_doc_ref.set(
        { getCondition: FieldValue.increment(1) },
        { merge: true }
      );
    }
    if (action === "logError") {  // ISSUE #76
      await log_doc_ref.set(
        { logError: FieldValue.increment(1)},
        { merge: true }
      );
      const date = new Date(Timestamp.now().toDate());
      const shortDate = new Intl.DateTimeFormat( 'en-GB', { dateStyle: 'short', timeStyle: 'long'} ).format(date);
      console.log(shortDate);
      await log_doc_ref.set( 
      { errors: FieldValue.arrayUnion({...error, time: shortDate})},
      { merge: true }
      )
    }
    return true;
  } catch (error) {
    return false;
  }
}
