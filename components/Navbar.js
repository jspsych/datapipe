import NextLink from "next/link";
import { useContext } from "react";
import { UserContext } from "../lib/context";
import {
  Box,
  Button,
  Text,
  Flex,
  HStack,
  Link,
  MenuItem,
  Menu,
  MenuButton,
  MenuList,
  MenuDivider,
  Image,
  IconButton,
} from "@chakra-ui/react";
import { AddIcon, HamburgerIcon } from "@chakra-ui/icons";

import { auth } from "../lib/firebase";

import { Rubik } from "@next/font/google";

const rubik = Rubik({ subsets: ["latin"] });

export default function Navbar() {
  const { user } = useContext(UserContext);

  return (
    <Box as="nav" flexShrink={0}>
      <Flex
        justifyContent={"space-between"}
        alignItems={"center"}
        p={"4"}
        w={"100%"}
        color={"white"}
      >
        <HStack spacing={4} alignItems={"center"} pe={"2"}>
          <NextLink href="/">
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
                  boxSize="64px"
                  quality={100}
                />
              </Box>
              <Text>DataPipe</Text>
            </Box>
          </NextLink>
          <HStack
            as={"nav"}
            fontSize="lg"
            spacing={8}
            display={{ base: "none", md: "flex" }}
          >
            <Link color="white" as={NextLink} href="/getting-started">
              Getting Started
            </Link>
            <Link color="white" as={NextLink} href="/api-docs">
              API Docs
            </Link>
            <Link color="white" as={NextLink} href="/faq">
              FAQ
            </Link>
            {user && (
              <Link color="white" as={NextLink} href="/admin">
                My Experiments
              </Link>
            )}
          </HStack>
        </HStack>
        <HStack display={{ base: "none", md: "flex" }} spacing={8}>
          {!user && (
            <>
              <NextLink href="/signin">
                <Button
                  variant={"ghost"}
                  colorScheme={"white"}
                  size={"sm"}
                  mr={4}
                >
                  Sign In
                </Button>
              </NextLink>
              <NextLink href="/signup">
                <Button variant={"outline"} colorScheme={"white"} size={"sm"}>
                  Sign Up
                </Button>
              </NextLink>
            </>
          )}
          {user && (
            <>
              <NextLink href="/admin/new">
                <Button
                  variant={"outline"}
                  colorScheme={"green"}
                  size={"sm"}
                  leftIcon={<AddIcon />}
                >
                  New Experiment
                </Button>
              </NextLink>
              <Menu>
                <MenuButton
                  as={Button}
                  colorScheme={"white"}
                  rounded={"full"}
                  variant={"link"}
                  cursor={"pointer"}
                  minW={0}
                >
                  Account
                </MenuButton>
                <MenuList bg="greyBackground">
                  <MenuItem bg="greyBackground">
                    <NextLink href="/admin/account">Settings</NextLink>
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem bg="greyBackground" onClick={() => auth.signOut()}>
                    Sign Out
                  </MenuItem>
                </MenuList>
              </Menu>
            </>
          )}
        </HStack>
        <HStack display={{ base: "flex", md: "none" }} spacing={8}>
          <Menu>
            <MenuButton
              as={IconButton}
              colorScheme={"white"}
              icon={<HamburgerIcon boxSize={8} />}
              cursor={"pointer"}
              minW={0}
            ></MenuButton>
            <MenuList w="90vw" bg="greyBackground">
              <MenuItem bg="greyBackground">
                <NextLink href="/getting-started">Getting Started</NextLink>
              </MenuItem>
              <MenuItem bg="greyBackground">
                <NextLink href="/api-docs">API Docs</NextLink>
              </MenuItem>
              <MenuItem bg="greyBackground">
                <NextLink href="/faq">FAQ</NextLink>
              </MenuItem>
              <MenuItem bg="greyBackground">
                <NextLink href="/admin">My Experiments</NextLink>
              </MenuItem>
              <MenuItem bg="greyBackground">
                <NextLink href="/admin/new">New Experiment</NextLink>
              </MenuItem>
              <MenuDivider />
              {!user && (
                <>
                  <MenuItem bg="greyBackground">
                    <NextLink href="/signup">Sign Up</NextLink>
                  </MenuItem>
                  <MenuItem bg="greyBackground">
                    <NextLink href="/signin">Sign In</NextLink>
                  </MenuItem>
                </>
              )}
              {user && (
                <MenuItem bg="greyBackground" onClick={() => auth.signOut()}>
                  Sign Out
                </MenuItem>
              )}
            </MenuList>
          </Menu>
        </HStack>
      </Flex>
    </Box>
  );
}
