// Import the functions you need from the SDKs you need
import { initializeApp, getApp } from "firebase/app";
//import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
//import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
let firebaseConfig;
let app;

try {
  // Check if Firebase app is already initialized
  try {
    app = getApp();
    console.log("Using existing Firebase app");
  } catch (error) {
    // No existing app, create a new one
    if (process.env.NEXT_PUBLIC_FIREBASE_CONFIG) {
      firebaseConfig = JSON.parse(process.env.NEXT_PUBLIC_FIREBASE_CONFIG);
      app = initializeApp(firebaseConfig);
    } else {
      // Use default config for emulators
      firebaseConfig = {
        projectId: "demo-project",
        apiKey: "demo-api-key",
        authDomain: "demo-project.firebaseapp.com",
        storageBucket: "demo-project.appspot.com",
        messagingSenderId: "123456789",
        appId: "1:123456789:web:abcdef123456"
      };
      app = initializeApp(firebaseConfig);
    }
    console.log("Created new Firebase app");
  }
} catch (error) {
  console.error("Error initializing Firebase:", error);
  // Fallback to default config
  firebaseConfig = {
    projectId: "demo-project",
    apiKey: "demo-api-key",
    authDomain: "demo-project.firebaseapp.com",
    storageBucket: "demo-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
  };
  app = initializeApp(firebaseConfig);
}
//const analytics = getAnalytics(app);

/*const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6Lec_7sjAAAAADlHy_ZYU75OHiKtFh1voIkSNBbo"),
  isTokenAutoRefreshEnabled: true,
});*/

export const auth = getAuth(app);

export const db = getFirestore(app);

// Connect to emulators only in development
if (process.env.NODE_ENV === "development") {
  try {
    connectAuthEmulator(auth, "http://localhost:9099");
    console.log("Connected to Auth emulator");
  } catch (error) {
    // Ignore errors if already connected
    console.log("Auth emulator connection:", error.message);
  }
  
  try {
    connectFirestoreEmulator(db, "localhost", 8080);
    console.log("Connected to Firestore emulator");
  } catch (error) {
    // Ignore errors if already connected
    console.log("Firestore emulator connection:", error.message);
  }
}
