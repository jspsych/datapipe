import { Button } from "@chakra-ui/react";
import { useClipboard } from "@chakra-ui/react";
import { CheckIcon } from "@chakra-ui/icons";

export default function CopyButton({ code }) {
  const { hasCopied, onCopy } = useClipboard(code);
  return (
    <Button size="sm" w={14} colorScheme="green" onClick={onCopy}>
      {hasCopied ? <CheckIcon /> : "Copy"}
    </Button>
  );
}
