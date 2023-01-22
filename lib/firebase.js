// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
//import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
//import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// production
const firebaseConfig = {
  apiKey: "AIzaSyBGS62MgyMVBCjUKIh_swXThpRvQ3C4NR8",
  authDomain: "osf-relay.firebaseapp.com",
  projectId: "osf-relay",
  storageBucket: "osf-relay.appspot.com",
  messagingSenderId: "54492763028",
  appId: "1:54492763028:web:beeddbf1165c2b86af7581",
  measurementId: "G-SGY37EGRK6",
};

// test
const firebaseConfig_TEST = {
  apiKey: "AIzaSyA9FU1fD5v3BtS-91V8sQE_WpyW3Ub9e7w",
  authDomain: "datapipe-test.firebaseapp.com",
  projectId: "datapipe-test",
  storageBucket: "datapipe-test.appspot.com",
  messagingSenderId: "699904257039",
  appId: "1:699904257039:web:1786b08871881518b9877a",
  measurementId: "G-DLEL6P7M1R",
};

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
