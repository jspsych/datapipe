import { useState, useEffect } from "react";
import AuthCheck from "../../components/AuthCheck";
import { useRouter } from "next/router";
import { useDocumentData, useCollectionData } from "react-firebase-hooks/firestore";
import { db, auth } from "../../lib/firebase";
import { doc, collection, query, where, orderBy } from "firebase/firestore";

import { Spinner, Flex, VStack, HStack, Text, Box, Center } from "@chakra-ui/react";

import Title from "../../components/dashboard/Title";
import ExperimentInfo from "../../components/dashboard/ExperimentInfo";
import ExperimentActive from "../../components/dashboard/ExperimentActive";
import ExperimentValidation from "../../components/dashboard/ExperimentValidation";
import MetadataControl from "../../components/dashboard/MetadataControl";
import FinalizeControl from "../../components/dashboard/FinalizeControl";
import CodeHints from "../../components/dashboard/CodeHints";
import ErrorPanel from "../../components/dashboard/ErrorPanel";
import QueuePanel, { UploadsResolvedNotice } from "../../components/dashboard/QueuePanel";

import PageHeader from "../../components/ui/PageHeader";
import SettingsSection from "../../components/ui/SettingsSection";
import GuidanceLine from "../../components/ui/GuidanceLine";
import StatusIndicator from "../../components/ui/StatusIndicator";
import EmptyState from "../../components/ui/EmptyState";

export async function getServerSideProps() {
  return { props: {} };
}

const plural = (n, word) => `${n} ${word}${n !== 1 ? "s" : ""}`;

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
  const [data, loading, error, snapshot] = useDocumentData(experimentRef);
  const logs = useDocumentData(logsRef)?.[0] || null;
  // The error slot used to be discarded here. This query needs a composite
  // index (experimentID + owner + status + createdAt); if that index is
  // missing, or security rules reject the read, `queueEntries` is [] forever
  // and the researcher sees a clean page while participant files sit
  // un-uploaded. A data-loss warning that silently disables itself is worse
  // than no warning at all -- PRODUCT.md Principle 5.
  const [, , queueError, queueSnapshot] = useCollectionData(queueRef);
  const queueEntries = queueSnapshot?.docs.map(d => ({ id: d.id, ...d.data() })) || [];

  const uploadError = logs?.logError;
  const errorLog = logs?.errors;

  // Track resolved state: show the success notice when the queue goes from
  // non-empty to empty.
  //
  // The comparison happens DURING RENDER -- React's documented way to adjust
  // state in response to a changed value -- rather than in an effect that
  // called setState, which forced a second render pass for every change in
  // queue length. React re-runs this component immediately on the setState
  // below, before touching the DOM, so no intermediate state is ever painted.
  //
  // This also fixes a latent bug in the effect version: it returned the timer
  // cleanup BEFORE recording the new count, so prevQueueCount kept its stale
  // non-zero value after a transition fired.
  const [showResolved, setShowResolved] = useState(false);
  const [prevQueueCount, setPrevQueueCount] = useState(queueEntries.length);

  if (prevQueueCount !== queueEntries.length) {
    setPrevQueueCount(queueEntries.length);
    if (prevQueueCount > 0 && queueEntries.length === 0) {
      setShowResolved(true);
    }
  }

  // Auto-hide, keyed off the flag rather than off the queue length, so the
  // 8-second window starts when the notice appears and is cancelled if it is
  // dismissed early by another transition.
  useEffect(() => {
    if (!showResolved) return undefined;
    const timer = setTimeout(() => setShowResolved(false), 8000);
    return () => clearTimeout(timer);
  }, [showResolved]);

  if (loading) {
    return (
      <Center w="100%" py={8}>
        <Spinner color="brandGreen.solid" size="xl" />
      </Center>
    );
  }

  // "This experiment does not exist." used to be printed for ANY error,
  // including permission-denied and offline -- a false statement, with no
  // retry and no route back. Split, and both branches now offer a way out.
  //
  // Not-found is decided from the SNAPSHOT rather than from `!data`: a
  // document that is merely still settling also has no data, and asserting
  // "not found" during that window would flash a false answer on every load.
  // `snapshot.exists()` is only false once Firestore has actually answered.
  const notFound = !!snapshot && !snapshot.exists();
  if (error || notFound) {
    return (
      <VStack w="100%" maxW="1100px" gap={6} align="stretch">
        <PageHeader
          title={notFound ? "Experiment not found" : "Could not load this experiment"}
          backHref="/admin"
          backLabel="Back to experiments"
        />
        <GuidanceLine>
          {notFound
            ? "No experiment with this ID belongs to your account. It may have been deleted, or the link may be wrong."
            : "DataPipe could not read this experiment. This is usually a connection problem -- reload the page to try again. If it keeps happening, the experiment may belong to a different account."}
        </GuidanceLine>
      </VStack>
    );
  }

  if (!data) return null;

  return (
    <VStack
      alignSelf="flex-start"
      align="flex-start"
      w="100%"
      // 1100px, DESIGN.md §4's dashboard measure. Was an unexplained 1200.
      maxW="1100px"
      gap={0}
    >
      <PageHeader
        backHref="/admin"
        backLabel="Back to experiments"
        titleSlot={<Title data={data} />}
        mb={4}
      />

      <HStack gap={4} mb={6} flexWrap="wrap">
        {/* Badges -> StatusIndicator. The "Active" badge was white on
            green.600 at 3.30:1, and the queued/error badges were solid chips
            in a second red and a second orange. StatusIndicator rides
            `status.*` and always states the status in words. */}
        <StatusIndicator
          status={data.active ? "ok" : "neutral"}
          label={data.active ? "Accepting data" : "Not accepting data"}
        />
        <Text fontSize="sm" color="fg.muted">
          {plural(data.sessions || 0, "completed session")}
        </Text>
        {queueEntries.length > 0 && (
          <StatusIndicator
            status={
              queueEntries.some((e) => e.status === "failed") ? "error" : "warning"
            }
            label={`${plural(queueEntries.length, "upload")} waiting to be stored`}
          />
        )}
        {uploadError && queueEntries.length === 0 && !showResolved && (
          <StatusIndicator status="error" label="Some submissions were rejected" />
        )}
      </HStack>

      {queueError && (
        <Box mb={4}>
          <StatusIndicator
            status="warning"
            label="DataPipe could not check for queued uploads."
          />
          <GuidanceLine mt={2}>
            Files may be waiting to reach your storage provider without this
            page being able to show them. Reload to try again.
          </GuidanceLine>
        </Box>
      )}

      {showResolved && (
        <Box w="100%" mb={4}>
          <UploadsResolvedNotice />
        </Box>
      )}
      {uploadError && queueEntries.length === 0 && !showResolved && (
        <Box w="100%" mb={4}>
          <ErrorPanel errors={errorLog} />
        </Box>
      )}
      {queueEntries.length > 0 && (
        <Box w="100%" mb={4}>
          <QueuePanel entries={queueEntries} experimentId={experiment_id} />
        </Box>
      )}

      {/* The notices above are one group of alerts (mb={4} between them);
          this mt lifts the body away from that group instead of leaving it
          the same 24px the notices used between themselves. */}
      <Flex w="100%" mt={6} gap={10} wrap="wrap" alignItems="flex-start">
        <VStack flex="1" minW="300px" gap={0} align="stretch">
          <ExperimentInfo data={data} />

          {/* Four `<Separator borderColor="whiteAlpha.200">` rules used to
              divide these sections. They composite to 1.26:1 -- not a weak
              separator, an absent one -- and DESIGN.md §4 bans the value and
              commits to spacing-only grouping between sections: mt={10}
              between routine ones, mt={16} before anything irreversible. The
              five illegible `xs`/uppercase/`gray.500` (3.43:1) eyebrows they
              sat under are gone with them; SettingsSection renders a real
              <h2> in sentence case, and every section now carries the
              one-line description this page has never had. */}
          <Box mt={10}>
            <SettingsSection
              title="Data collection"
              description="Turn this off to stop accepting new submissions. Data you have already collected is not affected."
            >
              <ExperimentActive data={data} />
            </SettingsSection>
          </Box>

          <Box mt={10}>
            <SettingsSection
              title="Validation"
              description="Reject submissions that do not match the format you expect, before they reach your storage provider."
            >
              <ExperimentValidation data={data} />
            </SettingsSection>
          </Box>

          <Box mt={10}>
            <SettingsSection title="Metadata">
              {/* The Psych-DS explanation used to live inside a popover
                  behind an icon-only "?" trigger -- meaning in a tooltip,
                  DESIGN.md §8.3. It is the section's description now, and
                  the link is brandGreen.fg (4.77:1 light / 6.71:1 dark)
                  rather than the retired blue.500 (§5). */}
              <GuidanceLine
                mb={4}
                href="https://psychds-docs.readthedocs.io/en/latest/"
                linkText="Learn more about Psych-DS"
                external
              >
                DataPipe can describe your data&apos;s columns -- their
                descriptions, value ranges and levels -- in a standard
                metadata file, so your dataset is easier for others to read
                and reuse.
              </GuidanceLine>
              <MetadataControl data={data} />
            </SettingsSection>
          </Box>

          {/* mt={16}, not mt={10}: the extra air is the signal that the next
              section plays by different rules. */}
          <Box mt={16}>
            <SettingsSection
              title="Finalize"
              description="Finalizing merges every file into a single archive on your storage provider, permanently deletes the loose files it was built from, and stops this experiment from accepting data forever. This cannot be undone."
              variant="danger"
            >
              <FinalizeControl data={data} experimentId={experiment_id} />
            </SettingsSection>
          </Box>
        </VStack>

        <VStack flex="1" minW="300px" align="stretch" gap={6}>
          {(data.sessions || 0) === 0 && (
            <EmptyState
              title="No data yet"
              body="Paste the code below into your experiment and run one session yourself. If it arrives, your study is wired up correctly."
            />
          )}
          <SettingsSection title="Integration code">
            <GuidanceLine
              mb={4}
              href="/getting-started"
              linkText="Read the getting started guide"
            >
              Paste this into your experiment to send its data to DataPipe.
            </GuidanceLine>
            <CodeHints expId={experiment_id} />
          </SettingsSection>
        </VStack>
      </Flex>
    </VStack>
  );
}
