import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth'
import { useState } from 'react'

import {auth} from '../lib/firebase'

export default function SignUpPage({}) {
  const [email_val, setEmail] = useState('');
  const [password_val, setPassword] = useState('');

  return (
    <div>
      <h1>Sign Up Page</h1>
      <div>
        <input type="email" id="email" placeholder="Email" value={email_val} onChange={(e)=>setEmail(e.value)} />
        <input type="password" id="password" placeholder="Password" value={password_val} onChange={(e)=>setPassword(e.value)} />
        <button onClick={()=>handleCreateAccountButton(email_val, password_val)}>Create Account</button>
      </div>
    </div>
  )
}

function handleCreateAccountButton(email, password) {
  console.log('called');
  console.log(email, password);
  createUserWithEmailAndPassword(auth, email, password)
  .then((userCredential) => {
    // Signed in 
    const user = userCredential.user;
    // ...
  })
  .catch((error) => {
    const errorCode = error.code;
    const errorMessage = error.message;
    console.log(errorCode, errorMessage);
  });
}

