import '../styles/globals.css'
import Navbar from '../components/Navbar'
import { UserContext } from '../lib/context'

import { getAuth } from 'firebase/auth'
import { useAuthState } from 'react-firebase-hooks/auth'

function MyApp({ Component, pageProps }) {

  const auth = getAuth();
  const [user, loading, error] = useAuthState(auth);

  return (
    <UserContext.Provider value={{user}} >
      <Navbar />
      <Component {...pageProps} />
    </UserContext.Provider>
  )
}

export default MyApp
