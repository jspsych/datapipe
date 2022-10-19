import AuthCheck from "../../components/AuthCheck";
import { collection, query } from "firebase/firestore";
import { db, auth } from '../../lib/firebase';
import { useCollectionData } from "react-firebase-hooks/firestore";
import Link from "next/link";

export default function AdminPage({}) {
  return (
    <AuthCheck>
      <h1>Your Experiments</h1>
      <ExperimentList />
    </AuthCheck>
  )
}

function ExperimentList() {
  const user = auth.currentUser;
  const ref = collection(db, `users/${user.uid}/experiments`);
  const q = query(ref);
  const [querySnapshot] = useCollectionData(q);

  console.log(querySnapshot)

  return (
    <div>
      {querySnapshot && querySnapshot.map(exp => <ExperimentItem key={exp.id} exp={exp} />)}
    </div>
  )
}

function ExperimentItem({exp}){
  return (
    <div id={exp.id}>
      <h2>{exp.title}</h2>
      <Link href={`/admin/${exp.id}`}>edit</Link>
      <p>{exp.active}</p>
    </div>
  )
}