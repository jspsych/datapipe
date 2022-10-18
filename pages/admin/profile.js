import AuthCheck from "../../components/AuthCheck"
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { useContext } from "react";
import { useDocumentData, useDocumentDataOnce } from "react-firebase-hooks/firestore";
import { UserContext } from "../../lib/context";

export default function ProfilePage({}) {

  return (
    <AuthCheck>
      <h1>Profile</h1>
      <ProfileForm />
    </AuthCheck>
  )
}

function ProfileForm() {
  const { user } = useContext(UserContext);
  const [data, loading, error, snapshot, reload] = useDocumentData(doc(db, 'users', user.uid));

  return(<>
    {loading && <p>Loading...</p>}
    {data && <>
      <input type="text" id="osf-token" placeholder="OSF Token" defaultValue={data.osfToken} />
      <button onClick={handleSaveButton}>Save</button>
    </>}
  </>)
}

async function handleSaveButton(token) {
  try {
    const userDoc = doc(db, 'users', auth.currentUser.uid);
    await setDoc(userDoc, {osfToken: document.querySelector("#osf-token").value}, {merge: true});
  } catch (error) {
    console.log(error);
  }
}