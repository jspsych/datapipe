import AuthCheck from "../../components/AuthCheck";
import { collection, query, where, doc, deleteDoc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useCollectionData } from "react-firebase-hooks/firestore";
import { useRef } from "react";
import Link from "next/link";
import {
  Heading,
  Box,
  Button,
  Table,
  Thead,
  Tbody,
  Tfoot,
  Tr,
  Th,
  Td,
  Tag,
  TagLabel,
  TableContainer,
  IconButton,
  HStack,
  VStack,
  Spinner,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  useDisclosure,
  Text,
  Tooltip,
  Stack,
} from "@chakra-ui/react";
import {
  CheckIcon,
  NotAllowedIcon,
  DeleteIcon,
  EditIcon,
} from "@chakra-ui/icons";

export default function AdminPage({}) {
  return (
    <AuthCheck>
      <VStack spacing={8} w={["100%", "960px"]}>
        <Stack
          justifyContent="space-between"
          w="100%"
          direction={["column", "row"]}
        >
          <Heading>Your Experiments</Heading>
          <Link href="/admin/new">
            <Button
              variant={"solid"}
              colorScheme={"brandTeal"}
              size={"md"}
              mr={4}
            >
              Create New Experiment
            </Button>
          </Link>
        </Stack>
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

  return (
    <>
      <TableContainer w="100%">
        <Table size="md">
          <Thead>
            <Tr>
              <Th color="white">Name</Th>
              <Th color="white" display={["none", "table-cell"]}>
                Data collection?
              </Th>
              <Th color="white" display={["none", "table-cell"]}>
                Base 64?
              </Th>
              <Th color="white" display={["none", "table-cell"]}>
                Conditions?
              </Th>
              <Th color="white" display={["none", "table-cell"]}>
                Sessions
              </Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {querySnapshot &&
              querySnapshot.map((exp) => (
                <ExperimentItem key={exp.id} exp={exp} />
              ))}
          </Tbody>
        </Table>
      </TableContainer>
      {loading && <Spinner color="green.500" size={"xl"} />}
    </>
  );
}

function ExperimentItem({ exp }) {
  return (
    <Tr id={exp.id}>
      <Td fontSize="lg">
        <Link href={`/admin/${exp.id}`}>{exp.title}</Link>
      </Td>
      <Td display={["none", "table-cell"]}>
        <ExperimentStatusTag prepend="Data collection" active={exp.active} />
      </Td>
      <Td display={["none", "table-cell"]}>
        <ExperimentStatusTag
          prepend="Base 64 data collection"
          active={exp.activeBase64}
        />
      </Td>
      <Td display={["none", "table-cell"]}>
        <ExperimentStatusTag
          prepend="Condition assignment "
          active={exp.activeConditionAssignment}
        />
      </Td>
      <Td display={["none", "table-cell"]}>{exp.sessions}</Td>
      <Td>
        <ExperimentActions exp={exp} />
      </Td>
    </Tr>
  );
}

function ExperimentStatusTag({ active, prepend }) {
  return (
    <Tooltip label={active ? `${prepend} is active` : `${prepend} is inactive`}>
      <Tag size="lg" variant="outline" colorScheme={active ? "green" : "gray"}>
        <TagLabel>
          {active ? <CheckIcon boxSize={4} /> : <NotAllowedIcon boxSize={4} />}
        </TagLabel>
      </Tag>
    </Tooltip>
  );
}

function ExperimentActions({ exp }) {
  return (
    <HStack>
      <Link href={`/admin/${exp.id}`}>
        <IconButton
          aria-label="Edit"
          icon={<EditIcon />}
          variant="outline"
          colorScheme="whiteAlpha"
        />
      </Link>
      <DeleteAlertDialog exp={exp} />
    </HStack>
  );
}

function DeleteAlertDialog({ exp }) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef();

  return (
    <>
      <IconButton
        aria-label="Delete"
        icon={<DeleteIcon />}
        onClick={onOpen}
        variant="outline"
        colorScheme="red"
      />

      <AlertDialog
        isOpen={isOpen}
        leastDestructiveRef={cancelRef}
        onClose={onClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent bg="greyBackground">
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete Experiment
            </AlertDialogHeader>

            <AlertDialogBody>
              <Text>Are you sure? This action is final.</Text>
              <Text>
                Deleting the experiment will not delete any data that is already
                on the OSF.
              </Text>
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onClose} colorScheme="brandTeal">
                Cancel
              </Button>
              <Button
                colorScheme="red"
                onClick={() => {
                  onClose();
                  deleteExperiment(exp);
                }}
                ml={3}
              >
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
}

async function deleteExperiment(exp) {
  const docRef = doc(db, `experiments/${exp.id}`);
  await deleteDoc(docRef);
}
