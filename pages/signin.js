import SignInForm from "../components/SignInForm";

export default function SignInPage() {
  return <SignInForm routeAfterSignIn={"/admin"} />;
}
