import AuthCheck from "../../components/AuthCheck";
import { collection, query, where } from "firebase/firestore";
import { db, auth } from '../../lib/firebase';
import { useCollectionData } from "react-firebase-hooks/firestore";
import Link from "next/link";
import { Heading, Box, Button, Text, Avatar, Flex, HStack, Link as ChakraLink, Stack, MenuItem, Menu, MenuButton, MenuList, MenuDivider, Icon } from "@chakra-ui/react";
import { CheckCircleIcon } from "@chakra-ui/icons";

export default function AdminPage({}) {
  return (
    <AuthCheck>
      <Heading>Your Experiments</Heading>
      <ExperimentList />
      <Link href="/admin/new">Create New Experiment</Link>
    </AuthCheck>
  )
}

function ExperimentList() {
  const user = auth.currentUser;
  const experiments = collection(db, `experiments`);
  const q = query(experiments, where("owner", "==", user.uid));
  const [querySnapshot] = useCollectionData(q);

  console.log(querySnapshot)

  return (
    <Box>
      {querySnapshot && querySnapshot.map(exp => <ExperimentItem key={exp.id} exp={exp} />)}
    </Box>
  )
}

function ExperimentItem({exp}){
  return (
    <Box id={exp.id}>
      <Heading>{exp.title}</Heading>
      <Link href={`/admin/${exp.id}`}>edit</Link>
      <CheckCircleIcon color={exp.active ? 'green' : 'red'}/>
    </Box>
  )
}