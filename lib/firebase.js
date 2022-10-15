// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
//import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBGS62MgyMVBCjUKIh_swXThpRvQ3C4NR8",
  authDomain: "osf-relay.firebaseapp.com",
  projectId: "osf-relay",
  storageBucket: "osf-relay.appspot.com",
  messagingSenderId: "54492763028",
  appId: "1:54492763028:web:beeddbf1165c2b86af7581",
  measurementId: "G-SGY37EGRK6"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
//const analytics = getAnalytics(app);

export const auth = getAuth(app);

export const db = getFirestore(app);

if(process.env.NODE_ENV === 'development') {
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFirestoreEmulator(db, 'localhost', 8080);
}

