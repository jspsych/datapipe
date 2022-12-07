import Link from "next/link";
import Image from "next/image";
import { useContext } from "react";
import { UserContext } from "../lib/context";
import { HStack, VStack, Container, Heading, Text, Button } from "@chakra-ui/react";

export default function Home() {
  const { user } = useContext(UserContext);

  return (
    <HStack px={12} maxW="1400px">
      <VStack spacing={4} align="start" flexBasis="66%">
        <Text fontSize="4xl" fontWeight="semibold">
          Send data from your behavioral experiments to the Open Science
          Framework, for free.
        </Text>
        {user ? (
          <Link href="/admin">Go to Dashboard</Link>
        ) : (
          <Link href="/signup">
            <Button variant={"outline"} colorScheme={"brandOrange"} size={"lg"}>
              Create an account
            </Button>
          </Link>
        )}
      </VStack>
      
      <Image src="/homepipe.png" alt="Hero Image" width="768" height="768" quality={100} />
      
    </HStack>
  );
}
