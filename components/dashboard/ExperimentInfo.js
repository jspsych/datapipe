import { Stack, HStack, Text, Link } from "@chakra-ui/react";

import { ExternalLink } from "lucide-react";
import { STORAGE_PROVIDERS } from "../../lib/provider-config";

export default function ExperimentInfo({ data }) {
  const provider = STORAGE_PROVIDERS[data.storageProvider];

  return (
    <Stack
      w="100%"
      gap={2}
    >
      <HStack justify="space-between" flexWrap="wrap" gap={1}>
        <Text color="gray.400" fontSize="sm">Experiment ID</Text>
        <Text fontSize="sm">{data.id}</Text>
      </HStack>
      {provider ? (
        <HStack justify="space-between" flexWrap="wrap" gap={1}>
          <Text color="gray.400" fontSize="sm">{provider.containerLabel}</Text>
          <Link
            color="white"
            fontSize="sm"
            href={provider.containerLink(data)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {data.providerContainer?.folderId} <ExternalLink style={{ display: "inline", width: "0.9em", height: "0.9em" }} />
          </Link>
        </HStack>
      ) : (
        <>
          <HStack justify="space-between" flexWrap="wrap" gap={1}>
            <Text color="gray.400" fontSize="sm">OSF Project</Text>
            <Link color="white" fontSize="sm" href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfRepo}`} target="_blank" rel="noopener noreferrer">
              {data.osfRepo} <ExternalLink style={{ display: "inline", width: "0.9em", height: "0.9em" }} />
            </Link>
          </HStack>
          <HStack justify="space-between" flexWrap="wrap" gap={1}>
            <Text color="gray.400" fontSize="sm">OSF Data Component</Text>
            <Link
              color="white"
              fontSize="sm"
              href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/${data.osfComponent}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {data.osfComponent} <ExternalLink style={{ display: "inline", width: "0.9em", height: "0.9em" }} />
            </Link>
          </HStack>
        </>
      )}
      <HStack justify="space-between">
        <Text color="gray.400" fontSize="sm">Completed Sessions</Text>
        <Text fontSize="sm">{data.sessions}</Text>
      </HStack>
    </Stack>
  );
}
