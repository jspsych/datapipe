import { Button } from "@chakra-ui/react";
import { Check } from "lucide-react";
import { useState } from "react";

export default function CopyButton({ code }) {
  const [hasCopied, setHasCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText(code);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  return (
    <Button size="sm" w={14} colorPalette="green" onClick={onCopy}>
      {hasCopied ? <Check /> : "Copy"}
    </Button>
  );
}
