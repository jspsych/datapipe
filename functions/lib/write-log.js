import { db } from "./app.js";
import { FieldValue } from "firebase-admin/firestore";
export default async function writeLog(experimentID, action) {
    try {
        const log_doc_ref = db.collection("logs").doc(experimentID);
        if (action === "saveData") {
            await log_doc_ref.set({ saveData: FieldValue.increment(1) }, { merge: true });
        }
        if (action === "saveBase64Data") {
            await log_doc_ref.set({ saveBase64Data: FieldValue.increment(1) }, { merge: true });
        }
        if (action === "getCondition") {
            await log_doc_ref.set({ getCondition: FieldValue.increment(1) }, { merge: true });
        }
        return true;
    }
    catch (error) {
        return false;
    }
}
//# sourceMappingURL=write-log.js.map