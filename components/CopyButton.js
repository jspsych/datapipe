import { Button } from '@chakra-ui/react';
import { useClipboard } from '@chakra-ui/react'

export default function CopyButton({ code }) {
    const { hasCopied, onCopy } = useClipboard(code)
    return (
        <Button size="sm" colorScheme="green" onClick={onCopy}>
            {hasCopied ? 'Copied' : 'Copy'}
        </Button>
    );
}