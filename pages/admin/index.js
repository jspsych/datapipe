import AuthCheck from "../../components/AuthCheck";
import { collection, query, where } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useCollectionData } from "react-firebase-hooks/firestore";
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
  Stack,
  Spinner
} from "@chakra-ui/react";
import { DeleteIcon, EditIcon } from "@chakra-ui/icons";

export default function AdminPage({}) {
  return (
    <AuthCheck>
      <Stack>
        <Heading>Your Experiments</Heading>
        <ExperimentList />
        <Link href="/admin/new">
          <Button variant={"solid"} colorScheme={"green"} size={"md"} mr={4}>
            Create New Experiment
          </Button>
        </Link>
      </Stack>
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
    <TableContainer>
      <Table>
        <Thead>
          <Tr>
            <Th>Experiment</Th>
            <Th>Status</Th>
            <Th>Completed Sessions</Th>
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
      <Td>{exp.title}</Td>
      <Td>
        <ExperimentStatusTag active={exp.active} />
      </Td>
      <Td>
        {exp.sessions}
      </Td>
      <Td>
        <ExperimentActions exp={exp} />
      </Td>
    </Tr>
  );
}

function ExperimentStatusTag({ active }) {
  return (
    <Tag size="sm" variant="solid" colorScheme={active ? "green" : "red"}>
      <TagLabel>{active ? "Active" : "Inactive"}</TagLabel>
    </Tag>
  );
}

function ExperimentActions({ exp }) {
  return (
    <HStack>
      <Link href={`/admin/${exp.id}`}>
        <IconButton aria-label="Edit" icon={<EditIcon />} />
      </Link>
      <IconButton aria-label="Delete" icon={<DeleteIcon />} />
    </HStack>
  );
}
