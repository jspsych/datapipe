import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useState } from "react";

import { auth, db } from "../lib/firebase";

export default function SignUpPage({}) {
  const [emailVal, setEmail] = useState("");
  const [passwordVal, setPassword] = useState("");

  return (
    <div>
      <h1>Sign Up Page</h1>
      <div>
        <input
          type="email"
          id="email"
          placeholder="Email"
          value={emailVal}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          id="password"
          placeholder="Password"
          value={passwordVal}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          onClick={() => handleCreateAccountButton(emailVal, passwordVal)}
        >
          Create Account
        </button>
      </div>
    </div>
  );
}

async function handleCreateAccountButton(email, password) {
  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user = userCredential.user;
    await setDoc(doc(db, "users", user.uid), {
      email: user.email,
      uid: user.uid,
      osfToken: "",
      osfTokenValid: false,
      experiments: []
    });
  }
  catch (error) {
    console.log(error);
  }
}
