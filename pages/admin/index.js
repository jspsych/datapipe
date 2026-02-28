import AuthCheck from "../../components/AuthCheck";
import { collection, query, where, doc, deleteDoc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useCollectionData } from "react-firebase-hooks/firestore";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  Heading,
  Box,
  Button,
  Table,
  Tag,
  IconButton,
  HStack,
  VStack,
  Spinner,
  Dialog,
  Text,
  Tooltip,
  Stack,
  Center,
  Card,
} from "@chakra-ui/react";
import { Check, Ban, Trash2, Pencil } from "lucide-react";

export default function AdminPage({}) {
  return (
    <AuthCheck>
      <VStack gap={8} w={["100%", "960px"]}>
        <ExperimentList />
      </VStack>
    </AuthCheck>
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
        <Spinner color="green.500" size={"xl"} />
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
          <Card.Root maxW="md" w="100%">
            <Card.Body>
              <VStack gap={6} textAlign="center">
                <VStack gap={3}>
                  <Heading size="md">
                    No experiments yet
                  </Heading>
                </VStack>

                <Link href="/admin/new">
                  <Button
                    colorPalette="brandTeal"
                    size="lg"
                    width="full"
                  >
                    Create Your First Experiment
                  </Button>
                </Link>
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

      <Box w="100%" overflowX="auto">
        <Table.Root size="md" w="100%">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader color="white">Name</Table.ColumnHeader>
              <Table.ColumnHeader color="white" display={["none", "table-cell"]}>
                Data collection?
              </Table.ColumnHeader>
              <Table.ColumnHeader color="white" display={["none", "table-cell"]}>
                Base 64?
              </Table.ColumnHeader>
              <Table.ColumnHeader color="white" display={["none", "table-cell"]}>
                Metadata?
              </Table.ColumnHeader>
              <Table.ColumnHeader color="white" display={["none", "table-cell"]}>
                Conditions?
              </Table.ColumnHeader>
              <Table.ColumnHeader color="white" display={["none", "table-cell"]}>
                Sessions
              </Table.ColumnHeader>
              <Table.ColumnHeader></Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {querySnapshot.map((exp) => (
              <ExperimentItem key={exp.id} exp={exp} />
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </VStack>
  );
}

function ExperimentItem({ exp }) {
  return (
    <Table.Row id={exp.id}>
      <Table.Cell fontSize="lg">
        <Link href={`/admin/${exp.id}`}>{exp.title}</Link>
      </Table.Cell>
      <Table.Cell display={["none", "table-cell"]}>
        <ExperimentStatusTag prepend="Data collection" active={exp.active} />
      </Table.Cell>
      <Table.Cell display={["none", "table-cell"]}>
        <ExperimentStatusTag
          prepend="Base 64 data collection"
          active={exp.activeBase64}
        />
      </Table.Cell>
      <Table.Cell display={["none", "table-cell"]}>
        <ExperimentStatusTag
          prepend="Metadata production"
          active={exp.metadataActive}
        />
      </Table.Cell>
      <Table.Cell display={["none", "table-cell"]}>
        <ExperimentStatusTag
          prepend="Condition assignment "
          active={exp.activeConditionAssignment}
        />
      </Table.Cell>
      <Table.Cell display={["none", "table-cell"]}>{exp.sessions}</Table.Cell>
      <Table.Cell>
        <ExperimentActions exp={exp} />
      </Table.Cell>
    </Table.Row>
  );
}

function ExperimentStatusTag({ active, prepend }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Tag.Root size="lg" variant="outline" colorPalette={active ? "green" : "gray"} color={active ? "green.400" : "gray.400"} opacity={active ? 1 : 0.75}>
          <Tag.Label>
            {active ? <Check size={16} /> : <Ban size={16} />}
          </Tag.Label>
        </Tag.Root>
      </Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Content>
          {active ? `${prepend} is active` : `${prepend} is inactive`}
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
