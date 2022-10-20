import Link from 'next/link';
import { useContext } from 'react';
import { UserContext } from '../lib/context';

export default function Navbar() {
  
  const { user } = useContext(UserContext);
  
  return (
    <nav className="navbar">
      <ul>
      {user ? (
        <>
          <li>
            <Link href="/admin">
              <button className="btn-blue">Experiments</button>
            </Link>
          </li>
          <li>
            <Link href={`/admin/profile`}>
              <button className="btn-blue">Profile Settings</button>
            </Link>
          </li>
          <li>
            <SignOutButton />
          </li>
        </>
      ) : (
        <>
          <li>
            <Link href="/signin">
              <button className="btn-blue">Sign In</button>
            </Link>
          </li>
        </>
      )}
      </ul>
    </nav>
  );
}

function SignOutButton() {
  return <button>Sign Out</button>
}