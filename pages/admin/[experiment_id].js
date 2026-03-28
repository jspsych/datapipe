import AuthCheck from "../../components/AuthCheck";
import { useRouter } from "next/router";
import { useDocumentData, useCollectionData } from "react-firebase-hooks/firestore";
import { db } from "../../lib/firebase";
import { doc, collection, query, where, orderBy } from "firebase/firestore";

import { Spinner, Flex, VStack, HStack, Text, Badge, Separator } from "@chakra-ui/react";

import Title from "../../components/dashboard/Title";
import ExperimentInfo from "../../components/dashboard/ExperimentInfo";
import ExperimentActive from "../../components/dashboard/ExperimentActive";
import ExperimentValidation from "../../components/dashboard/ExperimentValidation";
import MetadataControl from "../../components/dashboard/MetadataControl";
import CodeHints from "../../components/dashboard/CodeHints";
import ErrorPanel from "../../components/dashboard/ErrorPanel";
import QueuePanel from "../../components/dashboard/QueuePanel";

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
  const queueRef = experiment_id
    ? query(
        collection(db, "uploadQueue"),
        where("experimentID", "==", experiment_id),
        where("status", "in", ["pending", "processing", "failed"]),
        orderBy("createdAt", "desc")
      )
    : null;
  const [data, loading, error, snapshot, reload] = useDocumentData(experimentRef);
  const logs = useDocumentData(logsRef)?.[0] || null;
  const [queueData] = useCollectionData(queueRef, { idField: "id" });
  const queueEntries = queueData || [];

  const pendingUploads = queueEntries.filter(e => e.status === "pending" || e.status === "processing").length;
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
            {pendingUploads > 0 && (
              <Badge colorPalette="orange" variant="solid" px={2} py={1}>
                {pendingUploads} pending upload{pendingUploads !== 1 ? "s" : ""}
              </Badge>
            )}
            {pendingUploads === 0 && queueEntries.length > 0 && (
              <Badge colorPalette="red" variant="solid" px={2} py={1}>
                {queueEntries.length} failed upload{queueEntries.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </HStack>
          {uploadError && <ErrorPanel errors={errorLog} />}
          {queueEntries.length > 0 && <QueuePanel entries={queueEntries} experimentId={experiment_id} />}
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
              <CodeHints expId={experiment_id} />
            </VStack>
          </Flex>
        </VStack>
      )}
    </>
  );
}
