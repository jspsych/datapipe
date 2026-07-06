import AuthCheck from "../../components/AuthCheck";
import { collection, query, where, doc, deleteDoc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useCollectionData, useDocumentData } from "react-firebase-hooks/firestore";
import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import {
  Heading,
  Box,
  Button,
  IconButton,
  HStack,
  VStack,
  Spinner,
  Dialog,
  Text,
  Stack,
  Center,
  Card,
  CloseButton,
  Link as ChakraLink,
  Tooltip,
} from "@chakra-ui/react";
import { Trash2, Pencil } from "lucide-react";

export default function AdminPage({}) {
  return (
    <AuthCheck>
      <VStack gap={8} w="100%" maxW="960px" px={4}>
        <OAuthBanner />
        <ExperimentList />
      </VStack>
    </AuthCheck>
  );
}

function OAuthBanner() {
  const user = auth.currentUser;
  const [userData] = useDocumentData(doc(db, "users", user.uid));
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(
      localStorage.getItem("datapipe-oauth-banner-dismissed") === "true"
    );
  }, []);

  const hasOAuthConnection = userData?.refreshToken && userData?.authToken;

  if (dismissed || !userData || hasOAuthConnection) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem("datapipe-oauth-banner-dismissed", "true");
    setDismissed(true);
  };

  return (
    <Box
      w="100%"
      bg="brandTeal.900"
      border="1px solid"
      borderColor="brandTeal.600"
      borderRadius="md"
      px={4}
      py={3}
      position="relative"
    >
      <CloseButton
        size="sm"
        position="absolute"
        right={2}
        top={2}
        onClick={handleDismiss}
      />
      <Text pr={8}>
        <strong>Simplify your setup:</strong> You can now link your OSF account
        directly to DataPipe for automatic token management. Switch to one-click
        authentication in your{" "}
        <Link href="/admin/account">
          <Button variant="plain" colorPalette="brandTeal" fontSize="md" p={0} h="auto" minW={0}>
            Account Settings
          </Button>
        </Link>
        .
      </Text>
    </Box>
  );
}

function ExperimentList() {
  const user = auth.currentUser;
  const experiments = collection(db, `experiments`);
  const q = query(experiments, where("owner", "==", user.uid));
  const [querySnapshot, loading] = useCollectionData(q);

  if (loading) {
    return (
      <Center w="100%" py={8}>
        <Spinner color="brandTeal.500" size={"xl"} />
      </Center>
    );
  }

  if (!querySnapshot || querySnapshot.length === 0) {
    return (
      <VStack gap={8} w="100%">
        <Stack
          justifyContent="space-between"
          w="100%"
          direction={["column", "row"]}
        >
          <Heading>Your Experiments</Heading>
        </Stack>

        <Center w="100%" py={12}>
          <Card.Root maxW="lg" w="100%" bg="black" borderRadius={12} color="white">
            <Card.Body p={[5, 8]}>
              <VStack gap={5} textAlign="center">
                <Heading size="md">
                  No experiments yet
                </Heading>
                <Text color="gray.400" fontSize="sm" maxW="sm">
                  Experiments connect your online study to an OSF project so
                  that data files are sent directly to OSF as participants
                  complete your task.
                </Text>

                <Link href="/admin/new">
                  <Button
                    colorPalette="brandTeal"
                    size="lg"
                    width="full"
                  >
                    Create Your First Experiment
                  </Button>
                </Link>

                <Text color="gray.500" fontSize="xs">
                  Need help?{" "}
                  <ChakraLink asChild color="brandOrange.300">
                    <Link href="/getting-started">Read the Getting Started guide</Link>
                  </ChakraLink>
                </Text>
              </VStack>
            </Card.Body>
          </Card.Root>
        </Center>
      </VStack>
    );
  }

  return (
    <VStack gap={8} w="100%">
      <Stack
        justifyContent="space-between"
        w="100%"
        direction={["column", "row"]}
      >
        <Heading>Your Experiments</Heading>
        <Link href="/admin/new">
          <Button
            variant={"solid"}
            colorPalette={"brandTeal"}
            size={"md"}
            mr={4}
          >
            Create New Experiment
          </Button>
        </Link>
      </Stack>

      <VStack w="100%" gap={3}>
        {querySnapshot.map((exp) => (
          <ExperimentItem key={exp.id} exp={exp} />
        ))}
      </VStack>
    </VStack>
  );
}

function ExperimentItem({ exp }) {
  return (
    <Box
      id={exp.id}
      w="100%"
      bg="black"
      borderRadius={10}
      px={[4, 6]}
      py={4}
    >
      <Stack
        direction={["column", "row"]}
        justify="space-between"
        align={["start", "center"]}
        gap={[3, 4]}
      >
        <VStack align="start" gap={2} flex="1" minW={0}>
          <Link href={`/admin/${exp.id}`}>
            <Text fontSize="lg" fontWeight="semibold" _hover={{ textDecoration: "underline" }}>
              {exp.title}
            </Text>
          </Link>
          <HStack gap={[2, 4]} flexWrap="wrap" rowGap={1}>
            <StatusLabel label="Data" on={exp.active} feature="Data collection" />
            <StatusLabel label="Base64" on={exp.activeBase64} feature="Base64 data collection (for binary files like audio, video, and images)" />
            <StatusLabel label="Conditions" on={exp.activeConditionAssignment} feature="Sequential condition assignment" />
            <StatusLabel label="Metadata" on={exp.metadataActive} feature="Psych-DS metadata production" />
            {exp.sessions > 0 && (
              <Text fontSize="xs" color="gray.400">
                {exp.sessions} {exp.sessions === 1 ? "session" : "sessions"}
              </Text>
            )}
          </HStack>
        </VStack>
        <ExperimentActions exp={exp} />
      </Stack>
    </Box>
  );
}

function StatusLabel({ label, on, feature }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <HStack gap="5px">
          <Box
            w="6px"
            h="6px"
            borderRadius="full"
            bg={on ? "green.400" : "gray.600"}
          />
          <Text fontSize="xs" color={on ? "gray.300" : "gray.600"}>
            {label}
          </Text>
        </HStack>
      </Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Content maxW="xs">
          {feature} is {on ? "enabled" : "disabled"} for this experiment.
        </Tooltip.Content>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

function ExperimentActions({ exp }) {
  return (
    <HStack justifyContent="flex-end">
      <Link href={`/admin/${exp.id}`}>
        <IconButton
          aria-label="Edit"
          variant="outline"
          color="white"
          borderColor="white"
          _hover={{ bg: "whiteAlpha.300" }}
        >
          <Pencil />
        </IconButton>
      </Link>
      <DeleteAlertDialog exp={exp} />
    </HStack>
  );
}

function DeleteAlertDialog({ exp }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        aria-label="Delete"
        onClick={() => setOpen(true)}
        variant="outline"
        color="red.400"
        borderColor="red.400"
        _hover={{ bg: "whiteAlpha.300" }}
      >
        <Trash2 />
      </IconButton>

      <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="greyBackground" color="white">
            <Dialog.Header fontSize="lg" fontWeight="bold">
              Delete Experiment
            </Dialog.Header>

            <Dialog.Body>
              <Text>Are you sure? This action is final.</Text>
              <Text>
                Deleting the experiment will not delete any data that is already
                on the OSF.
              </Text>
            </Dialog.Body>

            <Dialog.Footer>
              <Button onClick={() => setOpen(false)} colorPalette="brandTeal">
                Cancel
              </Button>
              <Button
                colorPalette="red"
                onClick={() => {
                  setOpen(false);
                  deleteExperiment(exp);
                }}
                ml={3}
              >
                Delete
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </>
  );
}

async function deleteExperiment(exp) {
  const docRef = doc(db, `experiments/${exp.id}`);
  await deleteDoc(docRef);
}
