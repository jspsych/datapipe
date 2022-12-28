import { useContext } from "react";
import { UserContext } from "../lib/context";
import SignInForm from "./SignInForm";
import { useRouter } from "next/router";

export default function AuthCheck(props) {
  const router = useRouter();
  const { user } = useContext(UserContext);
  return user
    ? props.children
    : props.fallback || <SignInForm routeAfterSignIn={router.pathname} />;
}
