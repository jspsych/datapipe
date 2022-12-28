import { useRouter } from "next/router";
import { useEffect } from "react";

export default function Redirect() {
  const router = useRouter();

  useEffect(() => {
    if (router.query.mode) {
      switch (router.query.mode) {
        case "resetPassword": {
          router.push("/reset-password?token=" + router.query?.oobCode);
          break;
        }
        default: {
          router.push("/");
          break;
        }
      }
    }
  }, [router, router.query]);

  return <></>;
}
