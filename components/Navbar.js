import Link from 'next/link';
import { useContext } from 'react';
import { UserContext } from '../lib/context';

export default function Navbar() {
  
  const { user } = useContext(UserContext);
  
  return (
    <nav className="navbar">
      <ul>
        <li>
          <Link href="/">
            <button className="btn-logo">OSF-RELAY</button>
          </Link>
        </li>
      {user ? (
        <>
          <li>
            <Link href="/admin">
              <button className="btn-blue">Experiments</button>
            </Link>
          </li>
          <li>
            <Link href={`/admin/${username}`}>
              <button className="btn-blue">Profile Settings</button>
            </Link>
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