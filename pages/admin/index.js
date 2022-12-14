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
} from "@chakra-ui/react";
import { DeleteIcon, EditIcon } from "@chakra-ui/icons";

export default function AdminPage({}) {
  return (
    <AuthCheck>
      <VStack spacing={8} w="860px">
        <HStack justifyContent="space-between" w="100%">
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
        </HStack>
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
        <Table size="lg">
          <Thead>
            <Tr>
              <Th color="white">Name</Th>
              <Th color="white">Status</Th>
              <Th color="white">Completed Sessions</Th>
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
      <Td>
        <ExperimentStatusTag active={exp.active} />
      </Td>
      <Td>{exp.sessions}</Td>
      <Td>
        <ExperimentActions exp={exp} />
      </Td>
    </Tr>
  );
}

function ExperimentStatusTag({ active }) {
  return (
    <Tag size="lg" variant="solid" colorScheme={active ? "green" : "red"}>
      <TagLabel>{active ? "Active" : "Inactive"}</TagLabel>
    </Tag>
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
