import { Box, Container, HStack } from "@chakra-ui/react";
import CopyButton from "./CopyButton";

const customScrollBarCSS = {
  "::-webkit-scrollbar": {
    backgroundColor: "gray.800",
    height: "8px",
    paddingTop: "10px",
    borderRadius: "8px"
  },
  "::-webkit-scrollbar-thumb": {
    background: "gray.600",
    borderRadius: "8px"
  }
}

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
    <Box w="100%" bg="black" color="white" p={4} rounded="md" {...props}>
      <HStack alignItems="start" spacing={6}>
          <Container as="pre" fontFamily="monospace" pb={3} overflowX="auto" sx={customScrollBarCSS}>
            {code}
          </Container>
        <CopyButton code={children} />
      </HStack>
    </Box>
  );
}
