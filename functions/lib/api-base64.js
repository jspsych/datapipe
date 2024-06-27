import { onRequest } from "firebase-functions/v2/https";
import putFileOSF from "./put-file-osf.js";
import { db } from "./app.js";
import writeLog from "./write-log.js";
import isBase64 from "is-base64";
import MESSAGES from "./api-messages.js";
export const apiBase64 = onRequest({ cors: true }, async (req, res) => {
    const { experimentID, data, filename } = req.body;
    if (!experimentID || !data || !filename) {
        res.status(400).json(MESSAGES.MISSING_PARAMETER);
        return;
    }
    await writeLog(experimentID, "saveBase64Data");
    const exp_doc_ref = db.collection("experiments").doc(experimentID);
    const exp_doc = await exp_doc_ref.get();
    if (!exp_doc.exists) {
        res.status(400).json(MESSAGES.EXPERIMENT_NOT_FOUND);
        return;
    }
    const exp_data = exp_doc.data();
    if (!exp_data) {
        res.status(400).json(MESSAGES.EXPERIMENT_DATA_NOT_FOUND);
        return;
    }
    if (!exp_data.activeBase64) {
        res.status(400).json(MESSAGES.BASE64DATA_COLLECTION_NOT_ACTIVE);
        return;
    }
    if (!isBase64(data, { allowMime: true })) {
        res.status(400).json(MESSAGES.INVALID_BASE64_DATA);
        return;
    }
    let buffer;
    try {
        // this safely removes the mime type from the base64 data
        const split_data = data.split(",");
        if (split_data.length > 1) {
            buffer = Buffer.from(split_data[1], "base64");
        }
        else {
            buffer = Buffer.from(data, "base64");
        }
    }
    catch (e) {
        res.status(400).json(MESSAGES.INVALID_BASE64_DATA);
        return;
    }
    const user_doc = await db.doc(`users/${exp_data.owner}`).get();
    if (!user_doc.exists) {
        res.status(400).json(MESSAGES.INVALID_OWNER);
        return;
    }
    const user_data = user_doc.data();
    if (!user_data) {
        res.status(400).json(MESSAGES.USER_DATA_NOT_FOUND);
        return;
    }
    if (!user_data.osfToken) {
        res.status(400).json(MESSAGES.INVALID_OSF_TOKEN);
        return;
    }
    const result = await putFileOSF(exp_data.osfFilesLink, user_data.osfToken, buffer, filename);
    if (!result.success) {
        if (result.errorCode === 409 && result.errorText === "Conflict") {
            res.status(400).json(MESSAGES.OSF_FILE_EXISTS);
            return;
        }
        res.status(400).json(MESSAGES.OSF_UPLOAD_ERROR);
        return;
    }
    res.status(201).json(MESSAGES.SUCCESS);
});
//# sourceMappingURL=api-base64.js.map