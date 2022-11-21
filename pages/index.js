import Link from "next/link";
import { useContext } from "react";
import { UserContext } from "../lib/context";
import { HStack, VStack, Box, Heading, Text, Button } from "@chakra-ui/react";

export default function Home() {
  const { user } = useContext(UserContext);

  return (
    <HStack px={12}>
      <VStack spacing={4} align="start">
        <Text fontSize="2xl">
          Send data from your behavioral experiments to the Open Science
          Framework, for free.
        </Text>
        {user ? (
          <Link href="/admin">Go to Dashboard</Link>
        ) : (
          <Link href="/signup">
            <Button variant={"solid"} colorScheme={"green"} size={"md"}>
              Create an account
            </Button>
          </Link>
        )}
      </VStack>
      <Box w="50vw" h="100%" bg="gray.500"></Box>
    </HStack>
  );
}
