import AuthCheck from "../../components/AuthCheck"
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { useContext } from "react";
import { useDocumentData } from "react-firebase-hooks/firestore";
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
      <ValidToken isValid={data.osfTokenValid} />
      <SaveProfileButon isValid={data.osfTokenValid} />
    </>}
  </>)
}

function ValidToken({isValid}){
  return (
    <p>OSF Token is {isValid ? 'Valid' : 'Invalid'}</p>
  )
}

function SaveProfileButon({isValid}) {
  return (
    <button onClick={handleSaveButton}>Save</button>
  )
}

async function handleSaveButton() {
  const token = document.querySelector('#osf-token').value;
  try {
    const isTokenValid = await checkOSFToken(token);
    const userDoc = doc(db, 'users', auth.currentUser.uid);
    await setDoc(userDoc, {osfToken: token, osfTokenValid: isTokenValid}, {merge: true});  
  } catch (error) {
    console.log(error);
  }
}

async function checkOSFToken(token) {
  const data = await fetch('https://api.osf.io/v2/', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    }
  });

  if (data.status === 200) {
    return true;
  } else {
    return false;
  }
}