import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth'
import { useState } from 'react'

export default function SignUpPage({}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div>
      <h1>Sign Up Page</h1>
      <div>
        <input type="email" id="email" placeholder="Email" value={email} onChange={(e)=>setEmail(e.value)} />
        <input type="password" id="password" placeholder="Password" value={password} onChange={(e)=>setPassword(e.value)} />
        <button onClick={handleCreateAccountButton}>Create Account</button>
      </div>
    </div>
  )
}

function handleCreateAccountButton() {
  const auth = getAuth();
  createUserWithEmailAndPassword(auth, email, password)
  .then((userCredential) => {
    // Signed in 
    const user = userCredential.user;
    // ...
  })
  .catch((error) => {
    const errorCode = error.code;
    const errorMessage = error.message;
  });
}

