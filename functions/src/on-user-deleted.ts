import * as auth from "firebase-functions/v1/auth";
import { db } from "./app.js";
import { UserData } from "./interfaces.js";

export const onUserDeleted = auth.user().onDelete(async (user) => {
  const uid = user.uid;

  // Get the user document to find their experiments
  const userDocRef = db.collection("users").doc(uid);
  const userDoc = await userDocRef.get();

  if (userDoc.exists) {
    const userData = userDoc.data() as UserData;
    const experimentIds = userData.experiments || [];

    // Delete in batches of 500 (Firestore batch limit is 500 operations)
    const batchSize = 500;
    for (let i = 0; i < experimentIds.length; i += batchSize) {
      const batch = db.batch();
      const chunk = experimentIds.slice(i, i + batchSize);

      for (const experimentId of chunk) {
        batch.delete(db.collection("experiments").doc(experimentId));
        batch.delete(db.collection("logs").doc(experimentId));
      }

      await batch.commit();
    }

    // Delete the user document itself
    await userDocRef.delete();
  }
});
