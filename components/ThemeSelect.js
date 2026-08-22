import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Menu, Text } from "@chakra-ui/react";

// `useTheme()`'s `theme` value is undefined until next-themes has read the
// stored preference on the client (see next-themes' documented hydration
// pattern), so wiring the radio group's `value` straight to `theme` on the
// very first client render risks a result that disagrees with the render
// right after. Gate on a mounted flag using the same useSyncExternalStore
// idiom Navbar.js already uses for `showUser` -- a subscription that never
// fires, whose snapshot flips from the SSR answer to the client answer
// once hydration completes -- rather than a `useState`/`useEffect` pair
// that would cost an extra render.
const subscribeToNothing = () => () => {};
function useMounted() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
}

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// Labeled radio-item group for the three-way color-mode preference
// (DESIGN.md §2 "Mode strategy"). Rendered only behind the
// COLOR_MODE_TOGGLE flag (lib/feature-flags.js) by whichever menu embeds
// it -- this component itself doesn't know about the flag.
export default function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <Menu.ItemGroup>
      <Menu.ItemGroupLabel color="fg.muted" px="3" py="1.5" fontSize="sm">
        Theme
      </Menu.ItemGroupLabel>
      <Menu.RadioItemGroup
        value={mounted ? theme : undefined}
        onValueChange={(details) => setTheme(details.value)}
      >
        {THEME_OPTIONS.map(({ value, label }) => (
          <Menu.RadioItem
            key={value}
            value={value}
            color="fg"
            py="2"
            ps="8"
            pe="3"
            closeOnSelect={false}
            _hover={{ bg: "bg.muted" }}
          >
            <Menu.ItemIndicator>✓</Menu.ItemIndicator>
            <Text>{label}</Text>
          </Menu.RadioItem>
        ))}
      </Menu.RadioItemGroup>
    </Menu.ItemGroup>
  );
}
