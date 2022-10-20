import Link from 'next/link';
import { useContext } from 'react';
import { UserContext } from '../lib/context';

export default function Home() {

  const { user } = useContext(UserContext);

  return (
    <div>
      <h1>OSF Relay</h1>
      <p>Connect your behavioral experiments to the OSF, for free.</p>
      {user ? 
        <Link href="/admin">Go to Dashboard</Link>
        :
        <Link href="/signin">Create an Account</Link>
      }
    </div>
  )
}
