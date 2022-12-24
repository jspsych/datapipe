import Link from "next/link";
import { useContext } from "react";
import { UserContext } from "../lib/context";
import {
  Stack,
  VStack,
  Container,
  Heading,
  Text,
  Button,
  Image,
} from "@chakra-ui/react";

export default function Home() {
  const { user } = useContext(UserContext);

  return (
    <Stack direction={['column', 'row']} px={[2,12]} maxW={["95%", "1400px"]} flexDirection={["column-reverse", "row"]}>
      <VStack spacing={4} align="start" flexBasis="66%">
        <Text fontSize={["2xl", "4xl"]} fontWeight="semibold">
          Send data from your behavioral experiments to the Open Science
          Framework, for free.
        </Text>
        {user ? (
          <Link href="/admin">
            <Button variant={"outline"} colorScheme={"brandOrange"} size={"lg"}>
              Go to Dashboard
            </Button>
          </Link>
        ) : (
          <Link href="/signup">
            <Button variant={"outline"} colorScheme={"brandOrange"} size={"lg"}>
              Create an account
            </Button>
          </Link>
        )}
      </VStack>
      <Image
        src="/homepipe.png"
        alt="Decorative illustration of a pipe with data flowing through it"
        boxSize={["90%", "768px"]}
        quality={100}
      />
    </Stack>
  );
}
