import { useState, useEffect } from "react";
import AuthCheck from "../../components/AuthCheck";
import { useRouter } from "next/router";
import {
  useDocumentData,
  useCollectionData,
} from "react-firebase-hooks/firestore";
import { db, auth } from "../../lib/firebase";
import { doc, collection, query, where, orderBy } from "firebase/firestore";

import {
  Spinner,
  VStack,
  HStack,
  Heading,
  Stack,
  Text,
  Box,
  Center,
} from "@chakra-ui/react";

import Title from "../../components/dashboard/Title";
import ExperimentInfo from "../../components/dashboard/ExperimentInfo";
import ExperimentActive from "../../components/dashboard/ExperimentActive";
import ExperimentValidation from "../../components/dashboard/ExperimentValidation";
import MetadataControl from "../../components/dashboard/MetadataControl";
import FinalizeControl from "../../components/dashboard/FinalizeControl";
import CodeHints from "../../components/dashboard/CodeHints";
import ErrorPanel from "../../components/dashboard/ErrorPanel";
import QueuePanel, {
  UploadsResolvedNotice,
} from "../../components/dashboard/QueuePanel";

import PageHeader from "../../components/ui/PageHeader";
import SettingsSection from "../../components/ui/SettingsSection";
import GuidanceLine from "../../components/ui/GuidanceLine";
import StatusIndicator from "../../components/ui/StatusIndicator";
import SectionPanel from "../../components/dashboard/SectionPanel";
import { STORAGE_PROVIDERS } from "../../lib/provider-config";

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
  const experimentRef = experiment_id
    ? doc(db, `experiments/${experiment_id}`)
    : null;
  const logsRef = experiment_id ? doc(db, `logs/${experiment_id}`) : null;
  const uid = auth.currentUser?.uid;
  const queueRef =
    experiment_id && uid
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
  const queueEntries =
    queueSnapshot?.docs.map((d) => ({ id: d.id, ...d.data() })) || [];

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
          title={
            notFound ? "Experiment not found" : "Could not load this experiment"
          }
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

  // The rejected-submissions record is shown only once the upload queue is
  // clear and the "uploads resolved" notice has gone -- unchanged behaviour,
  // named here because the same condition drove both a status chip in the
  // header and a panel below it.
  const showErrorPanel =
    !!uploadError && queueEntries.length === 0 && !showResolved;
  const hasNotices =
    !!queueError || showResolved || showErrorPanel || queueEntries.length > 0;

  return (
    <VStack
      // `alignSelf="flex-start"` used to sit here. pages/_app.js centres main
      // content with `alignItems="center"`, and this was the only page in the
      // app that overrode it -- so on a wide window the 1100px page sat hard
      // against the left edge with ~460px of dead space beside it, out of
      // alignment with the navbar and footer, which are centred. `align`
      // stays: that is the alignment of this stack's own children.
      align="flex-start"
      w="100%"
      // 1100px, DESIGN.md §4's dashboard measure. Was an unexplained 1200.
      maxW="1100px"
      gap={0}
    >
      {/* The status line is part of the header now, not a loose row under it:
          it says what this experiment is doing right now, which is the same
          job the title is doing, and PageHeader owns the spacing between the
          two. */}
      <PageHeader
        backHref="/admin"
        backLabel="Back to experiments"
        titleSlot={
          <Stack gap={3} w="100%">
            <Title data={data} />
            <HStack gap={4} flexWrap="wrap">
              {/* Badges -> StatusIndicator. The "Active" badge was white on
                  green.600 at 3.30:1, and the queued/error badges were solid
                  chips in a second red and a second orange. StatusIndicator
                  rides `status.*` and always states the status in words.

                  Finalized takes this slot instead of sitting beside it --
                  same reasoning as the experiment list, including the legacy
                  case where a pre-existing finalized experiment still holds
                  `active: true`. The Danger zone panel further down carries
                  the detail; up here it only has to be the first thing the
                  page says about the experiment. */}
              {data.finalized ? (
                <StatusIndicator status="ok" label="Finalized" />
              ) : (
                <StatusIndicator
                  status={data.active ? "ok" : "neutral"}
                  label={data.active ? "Accepting data" : "Not accepting data"}
                />
              )}
              <Text fontSize="sm" color="fg.muted">
                {plural(data.sessions || 0, "completed session")}
              </Text>
              {queueEntries.length > 0 && (
                <StatusIndicator
                  status={
                    queueEntries.some((e) => e.status === "failed")
                      ? "error"
                      : "warning"
                  }
                  label={`${plural(
                    queueEntries.length,
                    "upload"
                  )} waiting to be stored`}
                />
              )}
              {showErrorPanel && (
                <StatusIndicator
                  status="error"
                  label="Some submissions were rejected"
                />
              )}
            </HStack>
          </Stack>
        }
      />

      {/* One group: everything that is true about this experiment RIGHT NOW
          and might need acting on. `gap={4}` inside the group, `mb={10}`
          below it, so the group reads as a group and the settings below it
          start on the page's normal section rhythm rather than 24px away. */}
      {hasNotices && (
        <Stack w="100%" gap={4} mb={10}>
          {/* Bordered, like every other block on the page. This warning used
              to be the one notice with no container at all -- a status line
              and a sentence sitting loose between two bordered alerts. */}
          {queueError && (
            <SectionPanel>
              <StatusIndicator
                status="warning"
                label="DataPipe could not check for queued uploads."
              />
              <GuidanceLine mt={2}>
                Files may be waiting to reach your storage provider without this
                page being able to show them. Reload to try again.
              </GuidanceLine>
            </SectionPanel>
          )}

          {showResolved && <UploadsResolvedNotice />}

          {/* `uploadError` is logs/{id}.logError -- the lifetime count. It is
              passed alongside the array because write-log.ts caps the array
              at 50 entries, so its length is a floor on the real number, not
              the number itself. */}
          {showErrorPanel && (
            <ErrorPanel errors={errorLog} totalCount={uploadError} />
          )}

          {queueEntries.length > 0 && (
            <QueuePanel entries={queueEntries} experimentId={experiment_id} />
          )}
        </Stack>
      )}

      {/* One ordered column, one width.

          The page used to be `<Flex>` with two `flex="1"` children, which at
          maxW 1100 and gap 10 gives each column exactly 530px: ~40% of the
          integration snippet sat behind a horizontal scrollbar, and the split
          was by category rather than by measure, so five sections went left
          and one went right and 750-900px of rail sat empty beside the
          settings.

          Collapsing that to one column fixed the columns but left two
          MEASURES -- reference content at the full 1100px, controls capped at
          DESIGN.md §4's 560px settings measure. Read top to bottom, that is
          what the eye reports as broken: two wide bordered panels, then four
          narrow ones, the right-hand 540px going empty from the middle of the
          page down. A single column gets a single width.

          So every section is `w="100%"` at the page's 1100px and nothing
          steps in or out. The cost is the one the 560px cap was buying off --
          a SettingsRow puts its label at the left edge and its switch at the
          right -- and it is paid knowingly. What that cap was really
          protecting, the 140-character description measure, is already
          handled a level down: GuidanceLine carries `maxW="70ch"`
          (components/ui/GuidanceLine.js), so row descriptions keep a readable
          measure at any container width. If the switch travel becomes a
          problem, fix it inside SettingsRow -- cap the label/description
          column and bring the switch in beside it -- rather than by narrowing
          the section and reintroducing the step.

          Order is the order of the work: what is this -> how do I configure
          it -> how do I wire it up -> how do I end it. */}

      {/* The ID / storage-link / session rows used to open a column with no
          heading and no container: the first thing on the page after the
          title was a set of loose label-value pairs. They are a section like
          everything else now, and a horizontal strip rather than a vertical
          list -- three short facts do not need 190px of height and never
          needed a column of their own. */}
      <SettingsSection
        title="Experiment details"
        description="Where this experiment's data lands, and how much of it has arrived."
      >
        <SectionPanel>
          <ExperimentInfo data={data} />
        </SectionPanel>
      </SettingsSection>

      {/* Settings. Four `<Separator borderColor="whiteAlpha.200">` rules used
          to divide these sections. They composite to 1.26:1 -- not a weak
          separator, an absent one -- and DESIGN.md §4 bans the value and
          commits to spacing-only grouping between sections: mt={10} between
          routine ones, mt={16} before anything irreversible. The five
          illegible `xs`/uppercase/`gray.500` (3.43:1) eyebrows they sat under
          are gone with them; SettingsSection renders a real <h2> in sentence
          case, and every section now carries the one-line description this
          page has never had.

          What spacing alone could NOT carry is the grouping INSIDE a section
          -- §4's own escape hatch, "grouping that spacing cannot carry alone
          gets a bordered container". Each section body is a SectionPanel, and
          the switches are hairline-separated rows inside one
          (components/dashboard/SectionPanel.js). */}
      <Box mt={10} w="100%">
        <SettingsSection
          title="Data collection"
          description="Turn this off to stop accepting new submissions. Data you have already collected is not affected."
        >
          <ExperimentActive data={data} />
        </SettingsSection>
      </Box>

      <Box mt={10} w="100%">
        <SettingsSection
          title="Validation"
          description="Reject submissions that do not match the format you expect, before they reach your storage provider."
        >
          <ExperimentValidation data={data} />
        </SettingsSection>
      </Box>

      <Box mt={10} w="100%">
        <SettingsSection title="Metadata">
          {/* The Psych-DS explanation used to live inside a popover behind
              an icon-only "?" trigger -- meaning in a tooltip, DESIGN.md
              §8.3. It is the section's description now, and the link is
              brandGreen.fg (4.77:1 light / 6.71:1 dark) rather than the
              retired blue.500 (§5). */}
          <GuidanceLine
            mb={4}
            href="https://psychds-docs.readthedocs.io/en/latest/"
            linkText="Learn more about Psych-DS"
            external
          >
            DataPipe can describe your data&apos;s columns -- their
            descriptions, value ranges and levels -- in a standard metadata
            file, so your dataset is easier for others to read and reuse.
          </GuidanceLine>
          <MetadataControl data={data} />
        </SettingsSection>
      </Box>

      {/* Below the settings, above the danger zone.

          It sat second, directly under the details strip, on the argument
          that wiring up the snippet IS the job on an experiment that has
          never run. It is reference material the rest of the time, and a
          researcher who comes back to this page comes back to change a
          setting -- so the settings are what should be in reach, and the
          snippet is what should be findable. The empty-state case is carried
          by the guidance line below instead, which changes wording while
          `sessions` is 0.

          Full width is no longer a special case for this section, but it is
          still what the section needs: at 1100px the `pre` gets ~964px
          against the ~900px the longest snippet line takes, so the
          horizontal scroll is gone rather than reduced. */}
      <Box mt={10} w="100%">
        <SettingsSection title="Integration code">
          <GuidanceLine
            mb={4}
            href="/getting-started"
            linkText="Read the getting started guide"
          >
            {(data.sessions || 0) === 0
              ? "Paste this into your experiment, then run one session yourself. If it arrives, your study is wired up correctly."
              : "Paste this into your experiment to send its data to DataPipe."}
          </GuidanceLine>
          {/* The tabbed code block had no edge either -- on a page with a
              second column beside it, the tab strip was the only thing
              suggesting where this group started. */}
          <SectionPanel>
            <CodeHints expId={experiment_id} />
          </SectionPanel>
        </SettingsSection>
      </Box>

      {/* Offered only where finalizing is a thing that can happen.

          Finalizing merges a study into one archive to stay under a
          provider's file-count ceiling, and Zenodo is the only provider that
          has one -- finalization.ts refuses everything else with
          `not-eligible`. Until now the section rendered for every provider,
          so a Drive or Dataverse researcher was shown a red Danger zone
          promising to stop their experiment "forever", walked through a
          confirmation dialog about permanently deleting their files, and
          only then told it could not be done. Offering an irreversible
          action that was never available is worse than not offering it.

          The whole section goes, not just the button: finalization is
          currently its only entry, and an empty Danger zone is its own kind
          of alarming.

          `supportsFinalizing` is the frontend's presentational mirror of the
          adapter's `capabilities.maxFileCount` (lib/provider-config.js); the
          server remains authoritative, and a legacy OSF experiment -- absent
          from that map entirely -- correctly falls through to false. */}
      {STORAGE_PROVIDERS[data.storageProvider]?.supportsFinalizing && (
        /* mt={16}, not mt={10}: the extra air is the signal that the next
          section plays by different rules.

          "Danger zone", not "Finalize", for parity with
          pages/admin/account.js -- the same title, the same variant="danger"
          container, so the one section on either page that cannot be undone
          is recognisable as the same thing in both places. Finalization
          becomes an <h3> INSIDE it: it is currently the only irreversible
          action here, and naming it as one entry in a zone rather than as the
          zone itself leaves room for the next one (experiment deletion)
          without another rename. */
        <Box mt={16} w="100%">
          <SettingsSection
            title="Danger zone"
            description="Actions here are permanent. Nothing in this section can be undone."
            variant="danger"
          >
            <Stack gap={3} align="flex-start">
              <Heading as="h3" size="sm" fontWeight="semibold" color="fg">
                Finalize
              </Heading>
              {/* Kept verbatim from the old section description. DESIGN.md
                §8.10: the confirmation dialog must not hold the only copy of
                the consequence, so it has to be stated here, before the
                button that opens it. */}
              <GuidanceLine>
                Finalizing merges every file into a single archive on your
                storage provider, permanently deletes the loose files it was
                built from, and stops this experiment from accepting data
                forever. This cannot be undone.
              </GuidanceLine>
              <FinalizeControl data={data} experimentId={experiment_id} />
            </Stack>
          </SettingsSection>
        </Box>
      )}
    </VStack>
  );
}
