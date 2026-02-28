import { IconButton } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export default function CopyButton({ code }) {
  const [hasCopied, setHasCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText(code);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  return (
    <IconButton
      aria-label="Copy code"
      size="sm"
      variant="outline"
      color="white"
      borderColor="white"
      _hover={{ bg: "whiteAlpha.300" }}
      onClick={onCopy}
    >
      {hasCopied ? <Check /> : <Copy />}
    </IconButton>
  );
}
