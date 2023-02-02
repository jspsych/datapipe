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
  HStack,
} from "@chakra-ui/react";
import { AddIcon, EditIcon, RepeatClockIcon } from "@chakra-ui/icons";

export default function Home() {
  const { user } = useContext(UserContext);

  const Feature = ({ title, text, icon }) => {
    return (
      <VStack flexBasis={"33%"}>
        {icon}
        <Text fontSize={["xl", "2xl"]} fontWeight="semibold">
          {title}
        </Text>
        <Text>{text}</Text>
      </VStack>
    );
  };

  return (
    <VStack maxW={["95%", "1400px"]} px={[2, 12]} spacing={["1rem", "2rem"]}>
      <Stack
        direction={["column", "row"]}
        flexDirection={["column-reverse", "row"]}
        align="center"
      >
        <VStack spacing={4} align="start" flexBasis="66%">
          <Text fontSize={["2xl", "4xl"]} fontWeight="semibold">
            Send data from your behavioral experiments to the Open Science
            Framework, for free.
          </Text>
          {user ? (
            <Link href="/admin">
              <Button
                variant={"outline"}
                colorScheme={"brandOrange"}
                size={"lg"}
              >
                Go to Dashboard
              </Button>
            </Link>
          ) : (
            <Link href="/signup">
              <Button
                variant={"outline"}
                colorScheme={"brandOrange"}
                size={"lg"}
              >
                Create an account
              </Button>
            </Link>
          )}
        </VStack>
        <Image
          src="/homepipe.png"
          alt="Decorative illustration of a pipe with data flowing through it"
          boxSize={["100%", "768px"]}
          quality={100}
        />
      </Stack>
      <Stack
        direction={["column", "row"]}
        w={"100%"}
        flexDirection={["column-reverse", "row"]}
        align="center"
      >
        <Feature
          icon={<AddIcon w={8} h={8} color={"brandOrange.500"} />}
          title={"Link your OSF Account"}
          text={
            "Simply create an OSF project or use an existing one, along with generating an OSF token to send files directly to it."
          }
        />
        <Feature
          icon={<EditIcon w={8} h={8} color={"brandOrange.500"} />}
          title={"Add DataPipe Code"}
          text={
            "Configure your experiment parameters and add our pre-generated code snippets into your web-based experiment."
          }
        />
        <Feature
          icon={<RepeatClockIcon w={8} h={8} color={"brandOrange.500"} />}
          title={"Publish your Experiment"}
          text={
            "Host your experiment on a static hosting website like Github Pages or Netlify, activate data collection, and sit back as data will be automatically sent to OSF."
          }
        />
      </Stack>
    </VStack>
  );
}
