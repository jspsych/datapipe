import AuthCheck from "../../components/AuthCheck";
import { collection, query, where, doc, deleteDoc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useCollectionData, useDocumentData } from "react-firebase-hooks/firestore";
import { useState } from "react";
import Link from "next/link";
import {
  Box,
  Button,
  IconButton,
  HStack,
  VStack,
  Spinner,
  Text,
  Stack,
  Center,
  Link as ChakraLink,
} from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import AddSignInMethodBanner from "../../components/account/AddSignInMethodBanner";
import UnverifiedEmailBanner from "../../components/account/UnverifiedEmailBanner";
import OsfSunsetNotice from "../../components/OsfSunsetNotice";
import { isLegacyOsfExperiment } from "../../lib/osf-sunset";
import { STORAGE_PROVIDERS } from "../../lib/provider-config";
import PageHeader from "../../components/ui/PageHeader";
import EmptyState from "../../components/ui/EmptyState";
import GuidanceLine from "../../components/ui/GuidanceLine";
import StatusIndicator from "../../components/ui/StatusIndicator";
import ConfirmDialog from "../../components/ui/ConfirmDialog";

export default function AdminPage({}) {
  return (
    <AuthCheck>
      <Dashboard />
    </AuthCheck>
  );
}

// Inside AuthCheck rather than in AdminPage itself, because everything here
// reads `auth.currentUser` and AuthCheck is what guarantees there is one.
//
// ONE subscription to users/{uid} for this page, passed down -- the convention
// pages/admin/account.js already follows (ProviderConnections, ContactEmail,
// OAuthTokenStatus and SelectAuth all take `data` as a prop and none of them
// subscribes). Two components here read that document for different reasons,
// and before this they opened a listener each: two live listeners on one
// document, two independent loading flickers, and two chances for them to
// render disagreeing states for a frame.
function Dashboard() {
  const user = auth.currentUser;
  const [userDoc] = useDocumentData(
    user?.uid ? doc(db, "users", user.uid) : null
  );

  return (
    /* DESIGN.md §4 allows exactly two measures: 560px for a single-subject
       settings column, 1100px for dashboard and marketing pages. This was
       960px, one of three different widths across the three dashboard
       routes (960 / 540 / 1200). */
    <VStack gap={8} w="100%" maxW="1100px" align="stretch">
      <AddSignInMethodBanner />
      <UnverifiedEmailBanner userDoc={userDoc} />
      <ExperimentList userDoc={userDoc} />
    </VStack>
  );
}

function ExperimentList({ userDoc }) {
  const user = auth.currentUser;
  const experiments = collection(db, `experiments`);
  const q = query(experiments, where("owner", "==", user.uid));
  const [querySnapshot, loading] = useCollectionData(q);

  // The zero-state has to know whether a storage provider is connected before
  // it can offer an honest action. A brand-new signup CANNOT create an
  // experiment until one is (PRODUCT.md: settings is a required activation
  // step, not a maintenance screen), and firestore.rules enforces it. Offering
  // "Create your first experiment" to someone who will be refused is the dead
  // end the critique traces persona Jordan into.
  const hasProvider = Object.values(STORAGE_PROVIDERS).some((p) =>
    p.isConnected(userDoc)
  );

  if (loading) {
    return (
      <Center w="100%" py={8}>
        <Spinner color="brandGreen.solid" size="xl" />
      </Center>
    );
  }

  if (!querySnapshot || querySnapshot.length === 0) {
    return (
      <VStack gap={8} w="100%" align="stretch">
        <PageHeader
          title="Your experiments"
          purpose="Each experiment gives you an ID to paste into your study, and a place for its data to land."
          mb={0}
        />

        {hasProvider ? (
          <EmptyState
            title="No experiments yet"
            body="An experiment connects your online study to the storage account you control, so data files are sent straight to your own account as participants finish."
            action={
              <Button asChild colorPalette="brandGreen" size="md">
                <Link href="/admin/new">Create an experiment</Link>
              </Button>
            }
            secondary={
              <GuidanceLine
                href="/getting-started"
                linkText="Read the getting started guide"
              >
                New to DataPipe?
              </GuidanceLine>
            }
          />
        ) : (
          <EmptyState
            title="Connect a storage provider first"
            body="DataPipe needs somewhere to put your data before you can create an experiment. Data goes straight from your participants to an account you control -- DataPipe never keeps a copy."
            action={
              <Button asChild colorPalette="brandGreen" size="md">
                <Link href="/admin/account">Connect a storage provider</Link>
              </Button>
            }
            secondary={
              <GuidanceLine
                href="/getting-started"
                linkText="Read the getting started guide"
              >
                Not sure which one to use?
              </GuidanceLine>
            }
          />
        )}
      </VStack>
    );
  }

  const hasLegacyOsfExperiment = querySnapshot.some(isLegacyOsfExperiment);

  return (
    <VStack gap={8} w="100%" align="stretch">
      <PageHeader
        title="Your experiments"
        purpose="Each experiment gives you an ID to paste into your study, and a place for its data to land."
        mb={0}
        action={
          <Button asChild variant="solid" colorPalette="brandGreen" size="md">
            <Link href="/admin/new">Create an experiment</Link>
          </Button>
        }
      />

      {hasLegacyOsfExperiment && <OsfSunsetNotice scope="dashboard" />}

      <VStack w="100%" gap={3} align="stretch">
        {querySnapshot.map((exp) => (
          <ExperimentItem key={exp.id} exp={exp} />
        ))}
      </VStack>
    </VStack>
  );
}

// The secondary feature flags are detail-page information, but a one-line
// summary of them is genuinely useful on a list of thirty studies. Rendered as
// a sentence in `fg.muted`, not as four colored dots whose meaning lived in a
// hover tooltip -- unreachable on touch, unreliable by keyboard, unannounced
// to a screen reader, and measuring 2.72:1 in the "off" state. DESIGN.md §8.2
// and §8.3 in one component.
function featureSummary(exp) {
  const on = [];
  if (exp.activeBase64) on.push("base64 uploads");
  if (exp.activeConditionAssignment) on.push("condition assignment");
  if (exp.metadataActive) on.push("Psych-DS metadata");
  if (on.length === 0) return null;
  if (on.length === 1) return `${on[0]} on`;
  return `${on.slice(0, -1).join(", ")} and ${on[on.length - 1]} on`;
}

// Which service actually holds this experiment's data. Worth a line on a list
// of thirty studies: a lab mid-migration has experiments on two or three
// providers at once, and nothing in a title says which. Legacy OSF
// experiments are absent from STORAGE_PROVIDERS by design (they keep their
// bespoke surfaces), so they are named separately rather than falling through
// to nothing -- those are exactly the rows whose location matters most while
// OSF is being retired.
function providerName(exp) {
  if (isLegacyOsfExperiment(exp)) return "OSF";
  return STORAGE_PROVIDERS[exp.storageProvider]?.name ?? null;
}

function ExperimentItem({ exp }) {
  const features = featureSummary(exp);
  const provider = providerName(exp);

  return (
    <Box
      id={exp.id}
      w="100%"
      // Was `bg="black"` with no border, sitting at 1.27:1 against the
      // #1C1F22 page -- a card with no discernible edge. DESIGN.md §1:
      // page-to-panel separation is 1.07:1 in BOTH modes by design, so
      // "panels must carry a border, never rely on the fill alone".
      // `border` is gray.500 in both modes: 4.50:1 light, 3.43:1 dark.
      bg="bg.panel"
      color="fg"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      px={[4, 6]}
      py={4}
    >
      <Stack
        direction={["column", "row"]}
        justify="space-between"
        align={["start", "center"]}
        gap={[3, 4]}
      >
        <VStack align="start" gap={2} flex="1" minW={0}>
          <ChakraLink asChild color="fg" fontSize="lg" fontWeight="semibold">
            <Link href={`/admin/${exp.id}`}>{exp.title}</Link>
          </ChakraLink>
          <HStack gap={[2, 4]} flexWrap="wrap" rowGap={2}>
            {/* One status per row, stated in words. "Data / Base64 /
                Conditions / Metadata" were feature NAMES, not statuses --
                whether each was on lived in the dot's hue.

                Finalized REPLACES the collecting/not-collecting line rather
                than joining it. Two reasons. "Not collecting" is the weaker
                and more reversible-sounding of the two facts, so leading with
                it buries the one that matters. And an experiment finalized
                before finalization started switching `active` off still holds
                `active: true` in Firestore -- reading `finalized` first is
                what stops those rows from advertising "Collecting data" on a
                sealed archive. */}
            {exp.finalized ? (
              <StatusIndicator status="ok" label="Finalized" />
            ) : (
              <StatusIndicator
                status={exp.active ? "ok" : "neutral"}
                label={exp.active ? "Collecting data" : "Not collecting"}
              />
            )}
            {/* "Stored on X", not a bare "Zenodo". Every other item on this
                line says what it is ("42 sessions", "base64 uploads on"); a
                lone proper noun among them would be the only one the reader
                has to work out. */}
            {provider && (
              <Text fontSize="sm" color="fg.muted">
                Stored on {provider}
              </Text>
            )}
            {exp.sessions > 0 && (
              <Text fontSize="sm" color="fg.muted">
                {exp.sessions} {exp.sessions === 1 ? "session" : "sessions"}
              </Text>
            )}
            {features && (
              <Text fontSize="sm" color="fg.muted">
                {features}
              </Text>
            )}
          </HStack>
        </VStack>
        <DeleteExperimentControl exp={exp} />
      </Stack>
    </Box>
  );
}

function DeleteExperimentControl({ exp }) {
  const [open, setOpen] = useState(false);

  // ConfirmDialog awaits this and, if it throws, KEEPS THE DIALOG OPEN and
  // renders the message inside it. The old code called `setOpen(false)` and
  // then `deleteExperiment(exp)` with no `await` and no error handling at
  // all: a delete rejected by security rules left the row on screen with
  // nothing said, and the researcher's only evidence was that the list did
  // not change.
  const handleDelete = async () => {
    try {
      await deleteDoc(doc(db, `experiments/${exp.id}`));
    } catch (err) {
      console.error("Delete experiment failed:", err);
      throw new Error(
        `Could not delete “${exp.title}”. Nothing has been changed -- check ` +
          `your connection and try again.`
      );
    }
  };

  const stillCollecting = exp.active && (exp.sessions || 0) > 0;

  return (
    <HStack justifyContent="flex-end">
      <IconButton
        aria-label={`Delete ${exp.title}`}
        onClick={() => setOpen(true)}
        variant="outline"
        // brandRed, not the stock `red.400` literal, and outline rather than
        // a filled chip. DESIGN.md §5 reserves red for irreversible
        // destruction, which this is. brandRed.border is 4.51:1 light /
        // 4.89:1 dark, clearing the 3:1 non-text floor with room.
        colorPalette="brandRed"
      >
        <Trash2 />
      </IconButton>

      <ConfirmDialog
        open={open}
        onOpenChange={(e) => setOpen(e.open)}
        title={`Delete “${exp.title}”?`}
        confirmLabel="Delete experiment"
        destructive
        onConfirm={handleDelete}
      >
        <Stack gap={3}>
          {/* Consequence before mechanism, and the experiment is NAMED --
              both in the heading above and here. A researcher with six
              studies was previously asked to confirm a title-less "Are you
              sure? This action is final." */}
          <Text>
            Participants running this study right now will get an error, and
            the experiment ID stops accepting data immediately.
          </Text>
          <Text>
            Data already written to your storage provider is not deleted. This
            cannot be undone.
          </Text>
          {stillCollecting && (
            <StatusIndicator
              status="warning"
              label={`This experiment is still collecting data (${exp.sessions} ${
                exp.sessions === 1 ? "session" : "sessions"
              } so far).`}
            />
          )}
        </Stack>
      </ConfirmDialog>
    </HStack>
  );
}
