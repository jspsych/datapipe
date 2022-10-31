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
        p={4}
      >
        <HStack spacing={8} alignItems={"center"}>
          <Box>
            <Icon as={VscDebugDisconnect} /> OSF Relay
          </Box>
          <HStack as={"nav"} spacing={4} display={{ base: "none", md: "flex" }}>
            <Link href="/admin" passHref>
              <ChakraLink>My Experiments</ChakraLink>
            </Link>
            <Link href="/support" passHref>
              <ChakraLink>Support</ChakraLink>
            </Link>
          </HStack>
        </HStack>
        <HStack>
          <Link href="/admin/new">
            <Button
              variant={"solid"}
              colorScheme={"green"}
              size={"sm"}
              mr={4}
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
