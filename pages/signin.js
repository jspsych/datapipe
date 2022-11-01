import SignInForm from "../components/SignInForm";
import { Box } from "@chakra-ui/react";

export default function SignInPage({}) {

  return (
    <Box>
      <SignInForm routeAfterSignIn={"/admin"}/>
    </Box>
  )
}