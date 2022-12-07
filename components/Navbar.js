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
import Image from "next/image";

import { Rubik } from "@next/font/google";

const rubik = Rubik({ subsets: ["latin"] });

export default function Navbar() {
  const { user } = useContext(UserContext);

  return (
    <Box as="nav">
      <Flex
        justifyContent={"space-between"}
        alignItems={"center"}
        p={"4"}
        w={"100%"}
        color={"white"}
      >
        <HStack spacing={4} alignItems={"center"} pe={"2"}>
          <Link href="/">
            <Box
              display={"flex"}
              alignItems={"center"}
              fontSize={"2xl"}
              className={rubik.className}
              pr={10}
            >
              <Box p={2}>
                <Image
                  src="/logo.png"
                  alt="DataPipe Logo"
                  width="64"
                  height="64"
                  quality={100}
                />
              </Box>
              <Text>DataPipe</Text>
            </Box>
          </Link>
          <HStack
            as={"nav"}
            fontWeight="bold"
            spacing={8}
            display={{ base: "none", md: "flex" }}
          >
            <Link href="/help" passHref>
              <ChakraLink>Help</ChakraLink>
            </Link>
            <Link href="/faq" passHref>
              <ChakraLink>FAQ</ChakraLink>
            </Link>
            {user && (
              <Link href="/admin" passHref>
                <ChakraLink>My Experiments</ChakraLink>
              </Link>
            )}
          </HStack>
        </HStack>
        <HStack ps={"2"}>
          {!user && (
            <>
              <Link href="/signin">
                <Button
                  variant={"ghost"}
                  colorScheme={"white"}
                  size={"sm"}
                  mr={4}
                >
                  Sign In
                </Button>
              </Link>
              <Link href="/signup">
                <Button variant={"outline"} colorScheme={"white"} size={"sm"}>
                  Sign Up
                </Button>
              </Link>
            </>
          )}
          {user && (
            <>
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
                  <MenuItem onClick={() => auth.signOut()}>Sign Out</MenuItem>
                </MenuList>
              </Menu>
            </>
          )}
        </HStack>
      </Flex>
    </Box>
  );
}
