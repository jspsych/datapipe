import Link from 'next/link';
import { useContext } from 'react';
import { UserContext } from '../lib/context';

export default function AuthCheck(props) {
  const { user } = useContext(UserContext);
  return user ? 
    props.children : 
    props.fallback || <Link href="/signin">You must be signed in</Link>;
}
