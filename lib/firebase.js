// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
//import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
//import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = JSON.parse(process.env.NEXT_PUBLIC_FIREBASE_CONFIG);

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
//const analytics = getAnalytics(app);

/*const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6Lec_7sjAAAAADlHy_ZYU75OHiKtFh1voIkSNBbo"),
  isTokenAutoRefreshEnabled: true,
});*/

export const auth = getAuth(app);

export const db = getFirestore(app);

if (process.env.NODE_ENV === "development") {
  connectAuthEmulator(auth, "http://localhost:9099");
  connectFirestoreEmulator(db, "localhost", 8080);
}
