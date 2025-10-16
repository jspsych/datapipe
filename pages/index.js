import Link from "next/link";
import { useContext } from "react";
import { UserContext } from "../lib/context";
import { Stack, VStack, Text, Button, Image } from "@chakra-ui/react";
import {
  AddIcon,
  EditIcon,
  RepeatClockIcon,
  RepeatIcon,
} from "@chakra-ui/icons";

export default function Home() {
  const { user } = useContext(UserContext);

  const Feature = ({ title, text, icon, flexBasis }) => {
    return (
      <VStack flexBasis={flexBasis} textAlign={"center"}>
        {icon}
        <Text fontSize={["xl", "2xl"]} fontWeight="semibold">
          {title}
        </Text>
        <Text>{text}</Text>
      </VStack>
    );
  };

  return (
    <VStack maxW={["95%", "1400px"]} px={[2, 12]} spacing={["1.5rem", "3rem"]}>
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
          objectFit={"contain"}
        />
      </Stack>
      <Stack
        direction={["column", "row"]}
        w={"100%"}
        flexDirection={["column-reverse", "row"]}
        align="center"
        spacing={["1rem", "4rem"]}
      >
        <Feature
          icon={<AddIcon w={8} h={8} color={"brandOrange.500"} />}
          title={"Link your OSF Account"}
          text={
            "Simply create an OSF project or use an existing one, along with generating an OSF token to allow DataPipe to send data to it."
          }
          flexBasis={"33%"}
        />
        <Feature
          icon={<EditIcon w={8} h={8} color={"brandOrange.500"} />}
          title={"Add DataPipe Code"}
          text={
            "Configure your experiment parameters and add our pre-generated code snippets into your web-based experiment."
          }
          flexBasis={"33%"}
        />
        <Feature
          icon={<RepeatClockIcon w={8} h={8} color={"brandOrange.500"} />}
          title={"Publish your Experiment"}
          text={
            "Host your experiment on a static hosting website like Github Pages or Netlify, activate data collection, and sit back as data will be automatically sent to OSF."
          }
          flexBasis={"33%"}
        />
      </Stack>
      <Stack
        direction={["column", "row"]}
        w={"100%"}
        flexDirection={["column-reverse", "row"]}
        align="center"
        spacing={["1rem", "2rem"]}
      >
        <Feature
          icon={<RepeatIcon w={8} h={8} color={"brandOrange.500"} />}
          title={"100% Free"}
          text={
            "With the Open Science Foundation as a methods to store data for free, " +
            "placed upon traditionally free web page hosting, means less worrying about " +
            "development and pricing, and more time spent on your experiments."
          }
          flexBasis={"50%"}
        />
        <Image
          src={"/xxxx.png"} //placeholder
          alt={"Picture of code with arrows pointing to many screens"}
          boxSize={["100%", "384px"]}
          quality={100}
          objectFit={"contain"}
        />
      </Stack>
    </VStack>
  );
}
