import { signInWithEmailAndPassword } from 'firebase/auth'
import { useState } from 'react'

export default function SignInPage({}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div>
      <h1>Sign In Page</h1>
      <div>
        <input type="email" id="email" placeholder="Email" value={email} onChange={(e)=>setEmail(e.value)} />
        <input type="password" id="password" placeholder="Password" value={password} onChange={(e)=>setPassword(e.value)} />
        <button onClick={handleSignInButton}>Sign In</button>
      </div>
    </div>
  )
}

function handleSignInButton() {

}

function SignOutButton() {

}