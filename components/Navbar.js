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
  Image,
  IconButton,
} from "@chakra-ui/react";
import { Plus, Menu as MenuIcon } from "lucide-react";
import { Menu } from "@chakra-ui/react";

import { auth } from "../lib/firebase";

import { Rubik } from "next/font/google";

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
        <HStack gap={4} alignItems={"center"} pe={"2"}>
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
                />
              </Box>
              <Text>DataPipe</Text>
            </Box>
          </NextLink>
          <HStack
            as={"nav"}
            fontSize="lg"
            gap={8}
            display={{ base: "none", md: "flex" }}
          >
            <Link color="white" focusRing="none" asChild>
              <NextLink href="/getting-started">Getting Started</NextLink>
            </Link>
            <Link color="white" focusRing="none" asChild>
              <NextLink href="/api-docs">API Docs</NextLink>
            </Link>
            <Link color="white" focusRing="none" asChild>
              <NextLink href="/faq">FAQ</NextLink>
            </Link>
            {user && (
              <Link color="white" focusRing="none" asChild>
                <NextLink href="/admin">My Experiments</NextLink>
              </Link>
            )}
          </HStack>
        </HStack>
        <HStack display={{ base: "none", md: "flex" }} gap={8}>
          {!user && (
            <>
              <NextLink href="/signin">
                <Button
                  variant={"ghost"}
                  colorPalette={"white"}
                  size={"sm"}
                  mr={4}
                >
                  Sign In
                </Button>
              </NextLink>
              <NextLink href="/signup">
                <Button variant={"outline"} colorPalette={"white"} size={"sm"}>
                  Sign Up
                </Button>
              </NextLink>
            </>
          )}
          {user && (
            <>
              <NextLink href="/admin/new">
                <Button
                  variant={"solid"}
                  colorPalette={"brandTeal"}
                  size={"sm"}
                >
                  <Plus /> New Experiment
                </Button>
              </NextLink>
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button
                    color="white"
                    rounded={"full"}
                    variant={"plain"}
                    cursor={"pointer"}
                    minW={0}
                  >
                    Account
                  </Button>
                </Menu.Trigger>
                <Menu.Positioner>
                  <Menu.Content bg="greyBackground" borderWidth="1px" borderColor="white" p="2">
                    <Menu.Item value="settings" bg="greyBackground" color="white" py="2" px="3" asChild>
                      <NextLink href="/admin/account">Settings</NextLink>
                    </Menu.Item>
                    <Menu.Separator />
                    <Menu.Item value="signout" bg="greyBackground" color="white" py="2" px="3" onClick={() => auth.signOut()}>
                      Sign Out
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Positioner>
              </Menu.Root>
            </>
          )}
        </HStack>
        <HStack display={{ base: "flex", md: "none" }} gap={8}>
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton
                colorPalette={"white"}
                cursor={"pointer"}
                minW={0}
                variant="ghost"
                aria-label="Menu"
              >
                <MenuIcon size={32} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content w="90vw" bg="greyBackground" borderWidth="1px" borderColor="white" p="2">
                <Menu.Item value="getting-started" bg="greyBackground" color="white" py="2" px="3" asChild>
                  <NextLink href="/getting-started">Getting Started</NextLink>
                </Menu.Item>
                <Menu.Item value="api-docs" bg="greyBackground" color="white" py="2" px="3" asChild>
                  <NextLink href="/api-docs">API Docs</NextLink>
                </Menu.Item>
                <Menu.Item value="faq" bg="greyBackground" color="white" py="2" px="3" asChild>
                  <NextLink href="/faq">FAQ</NextLink>
                </Menu.Item>
                <Menu.Item value="experiments" bg="greyBackground" color="white" py="2" px="3" asChild>
                  <NextLink href="/admin">My Experiments</NextLink>
                </Menu.Item>
                <Menu.Item value="new-experiment" bg="greyBackground" color="white" py="2" px="3" asChild>
                  <NextLink href="/admin/new">New Experiment</NextLink>
                </Menu.Item>
                <Menu.Separator />
                {!user && (
                  <>
                    <Menu.Item value="signup" bg="greyBackground" color="white" py="2" px="3" asChild>
                      <NextLink href="/signup">Sign Up</NextLink>
                    </Menu.Item>
                    <Menu.Item value="signin" bg="greyBackground" color="white" py="2" px="3" asChild>
                      <NextLink href="/signin">Sign In</NextLink>
                    </Menu.Item>
                  </>
                )}
                {user && (
                  <Menu.Item value="signout" bg="greyBackground" color="white" py="2" px="3" onClick={() => auth.signOut()}>
                    Sign Out
                  </Menu.Item>
                )}
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </HStack>
      </Flex>
    </Box>
  );
}
