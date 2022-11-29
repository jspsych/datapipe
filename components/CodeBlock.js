import { Box, HStack } from "@chakra-ui/react";
import CopyButton from "./CopyButton";

export default function CodeBlock({ children, ...props }) {
  let lines = children.split("\n");
  // remove first line if it is empty
  if(lines[0].trim() === "") {
    lines.shift();
  }
  // get indent of the first line
  const indent = lines[0].match(/^\s*/)[0].length;
  // remove indent from all lines
  lines = lines.map((line) => line.slice(indent));
  // join lines back together
  const code = lines.join("\n");

  return (
    <Box as="pre" bg="gray.800" color="white" p={4} rounded="md" {...props}>
      <HStack alignItems="start" spacing={6}>
        <code>
          {code}
        </code>
        <CopyButton code={children} />
      </HStack>
    </Box>
  );
}
