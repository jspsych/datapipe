import Link from "next/link";
import { useContext } from "react";
import { UserContext } from "../lib/context";
import {
  Box,
  Button,
  Text,
  Avatar,
  Flex,
  HStack,
  Heading,
  Link as ChakraLink,
  Stack,
  MenuItem,
  Menu,
  MenuButton,
  MenuList,
  MenuDivider,
  Icon,
} from "@chakra-ui/react";
import { AddIcon } from "@chakra-ui/icons";
import { VscDebugDisconnect } from "react-icons/vsc";
import { auth } from "../lib/firebase";

export default function Navbar() {
  const { user } = useContext(UserContext);

  return (
    <Box as="nav">
      <Flex
        justifyContent={"space-between"}
        alignItems={"center"}
        bg={"gray.100"}
        p={"4"}
        w={"100%"}
      >
        <HStack spacing={8} alignItems={"center"} pe={"2"}>
          <Box display={"flex"} alignItems={"center"}>
            <Icon as={VscDebugDisconnect} me={"1"} />
            <Link href="/"><ChakraLink>Pipe My Data</ChakraLink></Link>
          </Box>
          <HStack as={"nav"} spacing={4} display={{ base: "none", md: "flex" }}>
            <Link href="/admin" passHref>
              <ChakraLink>My Experiments</ChakraLink>
            </Link>
            <Link href="/help" passHref>
              <ChakraLink>Help</ChakraLink>
            </Link>
          </HStack>
        </HStack>
        <HStack ps={"2"}>
          <Link href="/admin/new">
            <Button
              variant={"solid"}
              colorScheme={"green"}
              size={"sm"}
              leftIcon={<AddIcon />}
            >
              New Experiment
            </Button>
          </Link>
          {user && (
            <Menu>
              <MenuButton
                as={Button}
                rounded={"full"}
                variant={"link"}
                cursor={"pointer"}
                minW={0}
              >
                Account
              </MenuButton>
              <MenuList>
                <MenuItem>
                  <Link href="/admin/profile" passHref>
                    <ChakraLink>Settings</ChakraLink>
                  </Link>
                </MenuItem>
                <MenuDivider />
                <MenuItem onClick={()=>auth.signOut()}>Sign Out</MenuItem>
              </MenuList>
            </Menu>
          )}
          {!user && (
            <Link href="/signin">
              <Button variant={"ghost"} colorScheme={"green"} size={"sm"} mr={4}>
                Sign In
              </Button>
            </Link>
          )}
        </HStack>
      </Flex>
    </Box>
  );
}
