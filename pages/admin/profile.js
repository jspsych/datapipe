import AuthCheck from "../../components/AuthCheck"
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { useState } from "react";

export default function ProfilePage({}) {

  const [token, setToken] = useState('');

  return (
    <AuthCheck>
      <h1>Profile</h1>
      <input type="text" id="osf-token" placeholder="OSF Token" value={token} onChange={(e)=>setToken(e.target.value)} />
      <button onClick={() => handleSaveButton(token)}>Save</button>
    </AuthCheck>
  )
}

async function handleSaveButton(token) {
  try {
    const userDoc = doc(db, 'users', auth.currentUser.uid);
    await setDoc(userDoc, {osfToken: token}, {merge: true});
  } catch (error) {
    console.log(error);
  }
}