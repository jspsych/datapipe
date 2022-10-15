import { signInWithEmailAndPassword } from 'firebase/auth'
import { useState } from 'react'

export default function SignInPage({}) {
  const [emailVal, setEmail] = useState('');
  const [passwordVal, setPassword] = useState('');

  return (
    <div>
      <h1>Sign In Page</h1>
      <div>
        <input type="email" id="email" placeholder="Email" value={emailVal} onChange={(e)=>setEmail(e.target.value)} />
        <input type="password" id="password" placeholder="Password" value={passwordVal} onChange={(e)=>setPassword(e.target.value)} />
        <button onClick={handleSignInButton}>Sign In</button>
      </div>
    </div>
  )
}

function handleSignInButton() {

}

function SignOutButton() {

}