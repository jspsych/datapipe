import AuthCheck from "../../components/AuthCheck";
import {
  VStack,
  Heading,
} from "@chakra-ui/react";
import ChangePassword from "../../components/account/ChangePassword";
import OSFToken from "../../components/account/OSFToken";

export default function AccountPage({}) {
  return (
    <AuthCheck>
      <VStack spacing={8} w="560px">
        <Heading>Account Settings</Heading>
        <ChangePassword />
        <OSFToken />
      </VStack>
    </AuthCheck>
  );
}

