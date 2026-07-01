import { useState, useEffect, useRef } from "react";
import AuthCheck from "../../components/AuthCheck";
import { useRouter } from "next/router";
import { useDocumentData, useCollectionData } from "react-firebase-hooks/firestore";
import { db, auth } from "../../lib/firebase";
import { doc, collection, query, where, orderBy } from "firebase/firestore";

import { Spinner, Flex, VStack, HStack, Text, Badge, Separator, Popover, IconButton, Link } from "@chakra-ui/react";
import NextLink from "next/link";
import { CircleHelp } from "lucide-react";

import Title from "../../components/dashboard/Title";
import ExperimentInfo from "../../components/dashboard/ExperimentInfo";
import ExperimentActive from "../../components/dashboard/ExperimentActive";
import ExperimentValidation from "../../components/dashboard/ExperimentValidation";
import MetadataControl from "../../components/dashboard/MetadataControl";
import CodeHints from "../../components/dashboard/CodeHints";
import ErrorPanel from "../../components/dashboard/ErrorPanel";
import QueuePanel, { UploadsResolvedNotice } from "../../components/dashboard/QueuePanel";

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
  const uid = auth.currentUser?.uid;
  const queueRef = experiment_id && uid
    ? query(
        collection(db, "uploadQueue"),
        where("experimentID", "==", experiment_id),
        where("owner", "==", uid),
        where("status", "in", ["pending", "processing", "failed"]),
        orderBy("createdAt", "desc")
      )
    : null;
  const [data, loading, error, snapshot, reload] = useDocumentData(experimentRef);
  const logs = useDocumentData(logsRef)?.[0] || null;
  const [, , , queueSnapshot] = useCollectionData(queueRef);
  const queueEntries = queueSnapshot?.docs.map(d => ({ id: d.id, ...d.data() })) || [];

  const uploadError = logs?.logError;
  const errorLog = logs?.errors;

  // Track resolved state: show success notice when queue goes from non-empty to empty
  const [showResolved, setShowResolved] = useState(false);
  const prevQueueCount = useRef(0);

  useEffect(() => {
    const currentCount = queueEntries.length;
    if (prevQueueCount.current > 0 && currentCount === 0) {
      setShowResolved(true);
      const timer = setTimeout(() => setShowResolved(false), 8000);
      return () => clearTimeout(timer);
    }
    prevQueueCount.current = currentCount;
  }, [queueEntries.length]);

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
            {uploadError && queueEntries.length === 0 && !showResolved && (
              <Badge colorPalette="red" variant="solid" px={2} py={1}>
                Data upload errors
              </Badge>
            )}
            {queueEntries.length > 0 && (
              <Badge
                colorPalette={queueEntries.some(e => e.status === "failed") ? "red" : "orange"}
                variant="solid"
                px={2}
                py={1}
              >
                {queueEntries.length} upload{queueEntries.length !== 1 ? "s" : ""} queued
              </Badge>
            )}
          </HStack>
          {showResolved && <UploadsResolvedNotice />}
          {uploadError && queueEntries.length === 0 && !showResolved && <ErrorPanel errors={errorLog} />}
          {queueEntries.length > 0 && (
            <QueuePanel entries={queueEntries} experimentId={experiment_id} />
          )}
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
              <HStack gap={1} mb={3} alignItems="center">
                <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" color="gray.500">
                  Metadata
                </Text>
                <Popover.Root>
                  <Popover.Trigger asChild>
                    <IconButton
                      aria-label="What is metadata production?"
                      variant="ghost"
                      size="2xs"
                      color="gray.500"
                    >
                      <CircleHelp size={14} />
                    </IconButton>
                  </Popover.Trigger>
                  <Popover.Positioner>
                    <Popover.Content maxW="xs">
                      <Popover.Body>
                        <Text fontSize="sm">
                          Generates Psych-DS metadata describing your data&apos;s
                          columns (descriptions, value ranges, and levels), making
                          your dataset easier to share and reuse.{" "}
                          <Link asChild color="blue.500">
                            <NextLink href="/faq">Learn more</NextLink>
                          </Link>
                        </Text>
                      </Popover.Body>
                    </Popover.Content>
                  </Popover.Positioner>
                </Popover.Root>
              </HStack>
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
