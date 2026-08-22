import { Box, HStack, Text } from "@chakra-ui/react";

// PRESENTATIONAL ONLY. Nothing here is fetched, live, or measured -- it is a
// drawing of a folder listing, and the figcaption next to it in pages/index.js
// says so in visible text. The page already shows the code a researcher sends;
// this shows the thing they are actually worried about, which is whether it
// arrives. Filenames, sizes and times are invented examples and must never be
// dressed up as real telemetry (PRODUCT.md principle 5).
//
// Built from the same mode-invariant `code.*` tokens as the code specimen, so
// it reads as the second half of one device and costs no new palette.
const EXAMPLE_FILES = [
  { name: "subject_01.csv", size: "4.2 KB", when: "2 min ago" },
  { name: "subject_02.csv", size: "4.1 KB", when: "6 min ago" },
  { name: "subject_03.csv", size: "3.9 KB", when: "11 min ago" },
];

export default function ArrivalsPanel() {
  return (
    <Box
      bg="code.bg"
      borderWidth="1px"
      // Same seam value as the code specimen: 4.50:1 light / 3.43:1 dark.
      borderColor="code.border"
      borderRadius={12}
      overflow="hidden"
    >
      <HStack
        px={4}
        py={2}
        bg="code.bg.header"
        borderBottomWidth="1px"
        borderColor="code.border.subtle"
      >
        <Text
          fontSize="xs"
          fontFamily="monospace"
          color="code.fg.muted"
          truncate
        >
          My Drive/DataPipe/memory-task/
        </Text>
      </HStack>
      <Box as="ul" listStyleType="none" px={4} py={2}>
        {EXAMPLE_FILES.map((file, i) => (
          <HStack
            as="li"
            key={file.name}
            justifyContent="space-between"
            gap={3}
            py={2}
            // Hairline inside an already-grouped region, which is the one place
            // DESIGN.md §4 still allows a rule.
            borderTopWidth={i === 0 ? 0 : "1px"}
            borderColor="code.border.subtle"
          >
            <Text
              fontSize={["xs", "xs", "sm"]}
              fontFamily="monospace"
              color="code.fg"
              truncate
            >
              {file.name}
            </Text>
            <HStack gap={3} flexShrink={0}>
              <Text fontSize="xs" fontFamily="monospace" color="code.fg.muted">
                {file.size}
              </Text>
              <Text fontSize="xs" color="code.fg.muted">
                {file.when}
              </Text>
            </HStack>
          </HStack>
        ))}
      </Box>
    </Box>
  );
}
