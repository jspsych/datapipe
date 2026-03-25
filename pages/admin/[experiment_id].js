import AuthCheck from "../../components/AuthCheck";
import { useRouter } from "next/router";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { db } from "../../lib/firebase";
import { doc } from "firebase/firestore";

import { Spinner, Flex, VStack, HStack, Text, Badge, Separator, Stack, Collapsible, Button } from "@chakra-ui/react";
import { Code, ChevronDown } from "lucide-react";

import Title from "../../components/dashboard/Title";
import ExperimentInfo from "../../components/dashboard/ExperimentInfo";
import ExperimentActive from "../../components/dashboard/ExperimentActive";
import ExperimentValidation from "../../components/dashboard/ExperimentValidation";
import MetadataControl from "../../components/dashboard/MetadataControl";
import CodeHints from "../../components/dashboard/CodeHints";
import ErrorPanel from "../../components/dashboard/ErrorPanel";

export async function getServerSideProps() {
  return { props: {} };
}

export default function ExperimentPage() {
  const router = useRouter();
  const { experiment_id } = router.query;

  return (
    <AuthCheck>
      <ExperimentPageDashboard experiment_id={experiment_id} />
    </AuthCheck>
  );
}

function ExperimentPageDashboard({ experiment_id }) {
  const experimentRef = experiment_id ? doc(db, `experiments/${experiment_id}`) : null;
  const logsRef = experiment_id ? doc(db, `logs/${experiment_id}`) : null;
  const [data, loading, error, snapshot, reload] = useDocumentData(experimentRef);
  const logs = useDocumentData(logsRef)?.[0] || null;

  const uploadError = logs?.logError;
  const errorLog = logs?.errors;

  return (
    <>
      {loading && <Spinner color="brandTeal.500" size={"xl"} />}
      {error && <Text>This experiment does not exist.</Text>}
      {data && (
        <VStack alignSelf="flex-start" align="flex-start" w="100%" maxW={1200} px={4}>
          <Title data={data} />
          <HStack gap={3} mb={2} flexWrap="wrap">
            <Badge colorPalette={data.active ? "green" : "gray"} variant="solid" px={2} py={1}>
              {data.active ? "Active" : "Inactive"}
            </Badge>
            <Text fontSize="sm" color="gray.400">
              {data.sessions || 0} session{data.sessions !== 1 ? "s" : ""}
            </Text>
            {uploadError && (
              <Badge colorPalette="red" variant="solid" px={2} py={1}>
                Data upload errors
              </Badge>
            )}
          </HStack>
          {uploadError && <ErrorPanel errors={errorLog} />}
          <Flex w="100%" gap={8} wrap="wrap" alignItems="flex-start">
            <VStack flex="1" minW="300px" gap={0} align="stretch">
              <ExperimentInfo data={data} />

              <Separator my={5} borderColor="whiteAlpha.200" />
              <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" color="gray.500" mb={3}>
                Data Collection
              </Text>
              <ExperimentActive data={data} />

              <Separator my={5} borderColor="whiteAlpha.200" />
              <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" color="gray.500" mb={3}>
                Validation
              </Text>
              <ExperimentValidation data={data} />

              <Separator my={5} borderColor="whiteAlpha.200" />
              <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" color="gray.500" mb={3}>
                Metadata
              </Text>
              <MetadataControl data={data} />
            </VStack>

            <VStack flex="1" minW="300px" align="stretch">
              <Collapsible.Root defaultOpen>
                <Collapsible.Trigger asChild>
                  <Button variant="ghost" color="gray.400" size="sm" px={0} _hover={{ color: "white" }}>
                    <Code size={16} /> Integration Code <ChevronDown size={14} />
                  </Button>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <VStack w="100%" mt={4}>
                    <CodeHints expId={experiment_id} />
                  </VStack>
                </Collapsible.Content>
              </Collapsible.Root>
            </VStack>
          </Flex>
        </VStack>
      )}
    </>
  );
}
