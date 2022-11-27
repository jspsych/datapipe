import { useRouter } from 'next/router'
import { useEffect } from 'react';

export default function Redirect() {
  const router = useRouter();

  useEffect(() => {
    switch (router?.query?.mode) {
      case "resetPassword": router.push('/reset-password?token=' + router?.query?.oobCode);
      default: router.push('/')
    }  
  }, [])
  
  return <></>;
}