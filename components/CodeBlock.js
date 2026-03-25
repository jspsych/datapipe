import { Box, HStack } from "@chakra-ui/react";
import CopyButton from "./CopyButton";
import { useEffect, useRef } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-markup";
import "prismjs/themes/prism-tomorrow.css";

const customScrollBarCSS = {
  "::-webkit-scrollbar": {
    backgroundColor: "gray.800",
    height: "8px",
    paddingTop: "10px",
    borderRadius: "8px",
  },
  "::-webkit-scrollbar-thumb": {
    background: "gray.600",
    borderRadius: "8px",
  },
};

export default function CodeBlock({ children, language = "javascript", ...props }) {
  let lines = children.split("\n");
  // remove first line if it is empty
  if (lines[0].trim() === "") {
    lines.shift();
  }
  // get indent of the first line
  const indent = lines[0].match(/^\s*/)[0].length;
  // remove indent from all lines
  lines = lines.map((line) => line.slice(indent));
  // join lines back together
  const code = lines.join("\n");

  const codeRef = useRef(null);

  useEffect(() => {
    if (codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [code]);

  return (
    <Box w="100%" bg="gray.800" color="white" p={4} rounded="md" {...props}>
      <HStack alignItems="start" justifyContent="space-between" gap={6}>
        <Box
          as="pre"
          fontFamily="monospace"
          pb={3}
          overflowX="auto"
          sx={customScrollBarCSS}
          style={{ background: "none", margin: 0, padding: 0 }}
        >
          <code ref={codeRef} className={`language-${language}`}>
            {code}
          </code>
        </Box>
        <CopyButton code={children} />
      </HStack>
    </Box>
  );
}
