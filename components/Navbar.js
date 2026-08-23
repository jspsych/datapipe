import NextLink from "next/link";
import { useContext, useSyncExternalStore } from "react";
import { useRouter } from "next/router";
import { UserContext } from "../lib/context";
import {
  Box,
  Button,
  Text,
  Flex,
  HStack,
  Link,
  IconButton,
} from "@chakra-ui/react";
import { Plus, Menu as MenuIcon } from "lucide-react";
import { Menu } from "@chakra-ui/react";

import { auth } from "../lib/firebase";
import LogoMark from "./LogoMark";

import { Space_Grotesk } from "next/font/google";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["600"] });

// `user` comes from an auth listener, so it is null in the server-rendered
// HTML and may be populated by the time the client hydrates -- rendering it
// straight away is a hydration mismatch. The fix is to render the server's
// answer on the hydration pass and the client's answer after, which is what
// useSyncExternalStore's third argument (getServerSnapshot) is for. This
// replaces a setState-in-effect "mounted" flag that did the same thing by
// scheduling an extra render.
//
// The store never changes, so subscribe is a no-op returning a no-op
// unsubscribe; the false -> true transition comes from React switching off
// getServerSnapshot once hydration completes.
const subscribeToNothing = () => () => {};

function useHydrated() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
}

export default function Navbar() {
  const { user } = useContext(UserContext);
  const hydrated = useHydrated();
  const showUser = hydrated ? user : null;
  const router = useRouter();
  const current = (href) => {
    // Documentation covers the whole /docs/* tree, so its nav item stays
    // highlighted on every page in that section, not just the index --
    // an exact match here would drop the highlight the instant a reader
    // clicks into /docs/experiments or any other subpage.
    const isActive =
      href === "/docs"
        ? router.pathname.startsWith("/docs")
        : router.pathname === href;
    return isActive ? "page" : undefined;
  };

  return (
    <Box
      as="nav"
      aria-label="Main"
      flexShrink={0}
      bg="bg"
      borderBottomWidth="1px"
      borderColor="border"
    >
      <Flex
        justifyContent={"space-between"}
        alignItems={"center"}
        p={"4"}
        w={"100%"}
        color={"fg"}
      >
        {/* The 48px that separates the wordmark from the first nav link is
            now a `gap` on this row. It used to be `pr={10}` on the logo's own
            Box, which is inside the <NextLink> -- so 40px of empty nav bar
            was part of the home link's click target. Gap owns sibling
            spacing; padding owns hit area. */}
        <HStack gap={{ base: 4, md: 12 }} alignItems={"center"}>
          <NextLink href="/" className="dp-logo-link">
            {/* 2.5 is off the §4 ladder and stays: this is the optical gap
                inside the logo lockup (mark to wordmark), not layout
                spacing between components. */}
            <Box display={"flex"} alignItems={"center"} gap={2.5}>
              {/* The mark and wordmark render in the logo's own colors, not
                  the page `fg` -- DESIGN.md §1 "Logo" / "The navbar is
                  mode-aware": `logo.mark` resolves #2E7D32 light / #F2F5F1
                  dark, deliberately distinct from `fg` in both modes.
                  LogoMark is a raw SVG component whose `color` prop lands
                  directly on a `fill` attribute, so it needs a real CSS
                  value rather than a Chakra token path -- the resolved CSS
                  custom property does that. The Text wordmark is a Chakra
                  component, so it can reference the token path directly.
                  The echo chevron keeps LogoMark's own #8BC34A default --
                  mark-only, never themed, LogoMark internals untouched. */}
              <LogoMark size={40} color="var(--chakra-colors-logo-mark)" />
              <Text
                className={spaceGrotesk.className}
                fontWeight="600"
                fontSize="22px"
                lineHeight="1"
                letterSpacing="-0.03em"
                color="logo.mark"
              >
                DataPipe
              </Text>
            </Box>
          </NextLink>
          <HStack fontSize="lg" gap={8} display={{ base: "none", md: "flex" }}>
            <Link color="fg" aria-current={current("/getting-started")} asChild>
              <NextLink href="/getting-started">Getting Started</NextLink>
            </Link>
            <Link color="fg" aria-current={current("/docs")} asChild>
              <NextLink href="/docs">Documentation</NextLink>
            </Link>
            {/* My Experiments is always rendered, including signed out --
                pages/admin/index.js wraps its content in AuthCheck, which
                renders the sign-in form in place and returns here after, so
                there is no dead end for a signed-out visitor. */}
            <Link color="fg" aria-current={current("/admin")} asChild>
              <NextLink href="/admin">My Experiments</NextLink>
            </Link>
          </HStack>
        </HStack>
        {/* gap={4}, not gap={8} plus an extra mr={4} on the first button.
            The account cluster is ONE group (Sign In + Sign Up, or New
            Experiment + Account); the nav links to its left are separate
            destinations at gap={8}. Tighter inside the group than between
            groups is the grouping cue -- 48px between two halves of a
            button pair was reading as two unrelated controls. */}
        <HStack display={{ base: "none", md: "flex" }} gap={4}>
          {!showUser && (
            <>
              <Button
                asChild
                variant={"ghost"}
                color="fg"
                size={"sm"}
                _hover={{ bg: "bg.muted" }}
              >
                <NextLink href="/signin">Sign In</NextLink>
              </Button>
              <Button
                asChild
                variant={"outline"}
                color="fg"
                borderColor="border"
                size={"sm"}
                _hover={{ bg: "bg.muted" }}
              >
                <NextLink href="/signup">Sign Up</NextLink>
              </Button>
            </>
          )}
          {showUser && (
            <>
              <Button asChild variant={"solid"} colorPalette={"brandGreen"} size={"sm"}>
                <NextLink href="/admin/new">
                  <Plus /> New Experiment
                </NextLink>
              </Button>
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button
                    color="fg"
                    rounded={"full"}
                    variant={"plain"}
                    cursor={"pointer"}
                    minW={0}
                  >
                    Account
                  </Button>
                </Menu.Trigger>
                {/* Menu items are py="3" throughout both menus (here and in
                    the mobile menu below): 12px + the ~20px line box is a
                    44px row. At py="2" they were 36px, and on the mobile
                    menu -- where every route on the site is a menu item --
                    that is nine crowded targets in a column. */}
                <Menu.Positioner>
                  <Menu.Content bg="bg.panel" borderWidth="1px" borderColor="border" p="2">
                    <Menu.Item
                      value="settings"
                      color="fg"
                      py="3"
                      px="3"
                      _hover={{ bg: "bg.muted" }}
                      asChild
                    >
                      <NextLink href="/admin/account">Settings</NextLink>
                    </Menu.Item>
                    <Menu.Separator borderColor="border.subtle" />
                    <Menu.Item
                      value="signout"
                      color="fg"
                      py="3"
                      px="3"
                      _hover={{ bg: "bg.muted" }}
                      onClick={() => auth.signOut()}
                    >
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
              {/* `minW={0}` collapsed the only navigation control on mobile
                  to its icon box. 11 = 44px, the minimum touch target. */}
              <IconButton
                color="fg"
                cursor={"pointer"}
                minW={"11"}
                minH={"11"}
                variant="ghost"
                aria-label="Menu"
                _hover={{ bg: "bg.muted" }}
              >
                <MenuIcon size={32} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content w="90vw" bg="bg.panel" borderWidth="1px" borderColor="border" p="2">
                <Menu.Item
                  value="getting-started"
                  color="fg"
                  py="3"
                  px="3"
                  _hover={{ bg: "bg.muted" }}
                  asChild
                >
                  <NextLink href="/getting-started">Getting Started</NextLink>
                </Menu.Item>
                <Menu.Item value="docs" color="fg" py="3" px="3" _hover={{ bg: "bg.muted" }} asChild>
                  <NextLink href="/docs">Documentation</NextLink>
                </Menu.Item>
                {/* My Experiments is always rendered, including signed out --
                    see the desktop nav comment above. Kept outside the
                    showUser block below, which still gates New Experiment
                    and Settings. */}
                <Menu.Item
                  value="experiments"
                  color="fg"
                  py="3"
                  px="3"
                  _hover={{ bg: "bg.muted" }}
                  asChild
                >
                  <NextLink href="/admin">My Experiments</NextLink>
                </Menu.Item>
                {showUser && (
                  <>
                    <Menu.Item
                      value="new-experiment"
                      color="fg"
                      py="3"
                      px="3"
                      _hover={{ bg: "bg.muted" }}
                      asChild
                    >
                      <NextLink href="/admin/new">New Experiment</NextLink>
                    </Menu.Item>
                    {/* Settings is the required activation step (PRODUCT.md
                        "first-time setup"): /admin/account must be reachable
                        from the mobile menu, not desktop-only. Placed last in
                        this group, immediately before the separator, to
                        mirror the desktop Account menu's Settings -> Sign Out
                        adjacency below. */}
                    <Menu.Item
                      value="settings"
                      color="fg"
                      py="3"
                      px="3"
                      _hover={{ bg: "bg.muted" }}
                      asChild
                    >
                      <NextLink href="/admin/account">Settings</NextLink>
                    </Menu.Item>
                  </>
                )}
                <Menu.Separator borderColor="border.subtle" />
                {!showUser && (
                  <>
                    {/* Matches the desktop order (Sign In, then Sign Up) --
                        the previous markup reversed them on mobile only. */}
                    <Menu.Item value="signin" color="fg" py="3" px="3" _hover={{ bg: "bg.muted" }} asChild>
                      <NextLink href="/signin">Sign In</NextLink>
                    </Menu.Item>
                    <Menu.Item value="signup" color="fg" py="3" px="3" _hover={{ bg: "bg.muted" }} asChild>
                      <NextLink href="/signup">Sign Up</NextLink>
                    </Menu.Item>
                  </>
                )}
                {showUser && (
                  <Menu.Item
                    value="signout"
                    color="fg"
                    py="3"
                    px="3"
                    _hover={{ bg: "bg.muted" }}
                    onClick={() => auth.signOut()}
                  >
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
