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
} from "@chakra-ui/react";
import { AddIcon } from "@chakra-ui/icons";

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
            fontWeight="bold"
            spacing={8}
            display={{ base: "none", md: "flex" }}
          >
            <Link as={NextLink} href="/help">
              Help
            </Link>
            <Link as={NextLink} href="/faq">
              FAQ
            </Link>
            {user && (
              <Link as={NextLink} href="/admin">
                My Experiments
              </Link>
            )}
          </HStack>
        </HStack>
        <HStack spacing={8}>
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
                    <NextLink href="/admin/profile">Settings</NextLink>
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
      </Flex>
    </Box>
  );
}
