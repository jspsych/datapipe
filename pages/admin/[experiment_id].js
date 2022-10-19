import AuthCheck from '../../components/AuthCheck';
import { useRouter } from 'next/router';
import { useDocumentData } from 'react-firebase-hooks/firestore';
import { useContext } from 'react';
import { UserContext } from '../../lib/context';
import { db, auth } from '../../lib/firebase';
import { doc } from "firebase/firestore";

export default function ExperimentPage() {

  const router = useRouter();
  const { experiment_id } = router.query;

  return (
    <AuthCheck>
      <h1>Experiment Page</h1>
      <ExperimentEditForm expId={experiment_id} />
    </AuthCheck>
  )
}

function ExperimentEditForm({expId}) {

  const [data, loading, error, snapshot, reload] = useDocumentData(doc(db, `users/${auth.currentUser.uid}/experiments/${expId}`));
  return (
    <>
      {loading && <p>Loading...</p>}
      {data && <>
        <input type="text" id="title" placeholder="Experiment Title" defaultValue={data.title} />
        <input type="text" id="osf-repo" placeholder="OSF Repo" defaultValue={data.osfRepo} />
        <input type="checkbox" id="active" defaultChecked={data.active} />
        <button onClick={handleSaveButton}>Save</button>
      </>}
    </>
  )
}

function handleSaveButton() {
  console.log("Saving");
}