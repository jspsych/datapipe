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
  Box,
} from "@chakra-ui/react";

export default function Home() {
  const { user } = useContext(UserContext);

  return (
    <Stack
      direction={["column", "row"]}
      px={[2, 12]}
      maxW={["95%", "1400px"]}
      flexDirection={["column-reverse", "row"]}
      align="center"
    >
      <VStack gap={4} align="start" flexBasis="66%">
        <Text fontSize={["2xl", "4xl"]} fontWeight="semibold">
          Send data from your behavioral experiments to the Open Science
          Framework, for free.
        </Text>
        <Box
          borderLeft="3px solid"
          borderColor="brandTeal.400"
          bg="whiteAlpha.100"
          px={4}
          py={3}
          borderRadius="md"
        >
          <Text fontSize="md">
            <strong>New: Sign in with your OSF account.</strong> Link your OSF
            account directly to DataPipe for automatic token management.{" "}
            <Link href="/getting-started">
              <Button variant="plain" colorPalette="brandTeal" fontSize="md" p={0} h="auto" minW={0}>
                Learn more
              </Button>
            </Link>
          </Text>
        </Box>
        {user ? (
          <Link href="/admin">
            <Button variant={"outline"} colorPalette={"brandOrange"} size={"lg"}>
              Go to Dashboard
            </Button>
          </Link>
        ) : (
          <Link href="/signup">
            <Button variant={"outline"} colorPalette={"brandOrange"} size={"lg"}>
              Create an account
            </Button>
          </Link>
        )}
      </VStack>
      <Image
        src="/homepipe.png"
        alt="Decorative illustration of a pipe with data flowing through it"
        width={["100%", "768px"]}
      />
    </Stack>
  );
}
