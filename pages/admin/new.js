import { useContext, useState } from 'react';
import { customAlphabet } from 'nanoid';
import AuthCheck from '../../components/AuthCheck';
import { UserContext } from '../../lib/context';
import { doc, setDoc } from "firebase/firestore";

import { db } from '../../lib/firebase';

export default function New({}) {

  const { user } = useContext(UserContext);

  const [expTitle, setExpTitle] = useState("");

  return (
    <AuthCheck>
      <div>
        <h1>Create a New Experiment</h1>
        <input type="text" id="title" value={expTitle} placeholder="Experiment Title" onChange={(e)=>{setExpTitle(e.target.value)}}/>
        <button onClick={() => handleCreateExperiment(user, expTitle)}>Create</button>
      </div>
    </AuthCheck>
  );
}

async function handleCreateExperiment(user, title){
  //e.preventDefault();
  console.log("Creating experiment");
  const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 12);
  const id = nanoid();

  try {
    await setDoc(doc(db, `users/${user.uid}/experiments/${id}`), {
      title: title,
      active: false,
      id: id,
      osfRepo: ""
    });
  } catch (error) {
    console.log(error);
  }
  
}