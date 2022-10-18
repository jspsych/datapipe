import AuthCheck from "../../components/AuthCheck"
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { useContext, useState, useEffect } from "react";
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
      <ValidToken token={data.osfToken} />
    </>}
  </>)
}

function ValidToken({token}){
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
    const osfAPIFetch = async () => {
      const data = await fetch('https://api.osf.io/v2/', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      });

      if (data.status === 200) {
        setIsValid(true);
      } else {
        setIsValid(false);
      }
    }

    osfAPIFetch();
  }, [token]);

  return (
    <p>{isValid ? 'Valid' : 'Invalid'}</p>
  )
}

async function handleSaveButton(token) {
  try {
    const userDoc = doc(db, 'users', auth.currentUser.uid);
    await setDoc(userDoc, {osfToken: document.querySelector("#osf-token").value}, {merge: true});
  } catch (error) {
    console.log(error);
  }
}