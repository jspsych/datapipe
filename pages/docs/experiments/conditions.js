import { Code, Link as ChakraLink, List, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

// Prose link, per DESIGN.md §5: brandGreen.fg with a persistent underline, so
// a link is never signalled by color alone. Local to this page for the same
// reason pages/index.js keeps its own -- there is no shared prose-link
// primitive yet, and this package owns only page files.
function ProseLink({ href, external, children }) {
  const style = {
    color: "brandGreen.fg",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  };

  if (external) {
    return (
      <ChakraLink href={href} target="_blank" rel="noopener noreferrer" {...style}>
        {children}
      </ChakraLink>
    );
  }

  return (
    <ChakraLink asChild {...style}>
      <NextLink href={href}>{children}</NextLink>
    </ChakraLink>
  );
}

export default function ConditionAssignmentPage() {
  return (
    <>
      <PageHeader
        title="Condition assignment"
        purpose="How DataPipe assigns participants to conditions, and what it deliberately does not do."
      />

      <DocsSection id="how-many-conditions" title="How many conditions">
        <Text maxW="70ch">
          When enabled, DataPipe assigns condition numbers sequentially. It
          returns a number from 0 to n−1, where n is the number of conditions
          you configure. For example, with 3 conditions the sequence is 0, 1, 2,
          0, 1, 2, and so on.
        </Text>
        <Text maxW="70ch">
          <strong>Set the number when you turn the switch on.</strong> A new
          DataPipe experiment is created with one condition, and with one
          condition every participant is handed 0 and nothing ever advances. The
          dashboard field will not go below 2, so a study that needs conditions
          needs you to type the number in.
        </Text>
        <Text maxW="70ch">
          Underneath, DataPipe keeps a single counter on the experiment. Each
          request returns the counter&apos;s current value and then advances it
          — wrapping back to 0 after n−1 — and it does both inside one
          transaction, so two participants who ask at the same moment always get
          different numbers rather than the same one twice.
        </Text>
        <Text maxW="70ch">
          Nothing resets the counter. Turning condition assignment off and on
          again picks up exactly where it left off, and so does changing the
          number of conditions: if you lower n mid-study, the next participant
          can receive a number that is now out of range, and the one after that
          starts again at 0. Change n before you recruit, not during.
        </Text>
        <GuidanceLine href="/docs/experiments/sending-data#jspsych" linkText="Sending data from your experiment">
          The code samples include a ready-made condition request for jsPsych
          and for plain JavaScript.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="what-it-is-not" title="What it is not">
        <List.Root maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              It is not random assignment.
            </Text>{" "}
            The order is fixed and predictable. If your design needs
            randomisation, randomise in your own experiment code and leave this
            switch off.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              It does not re-balance.
            </Text>{" "}
            A participant who requests a condition and then closes the tab has
            still consumed that number; the sequence moves on regardless. Over a
            study with dropouts, your cells will not end up exactly equal, so
            check the counts in your data rather than assuming them.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              It is not tied to data collection.
            </Text>{" "}
            Condition requests are answered whether or not the experiment is
            accepting data, and even after an experiment has been{" "}
            <ProseLink href="/docs/data/finalizing">finalized</ProseLink>. The
            only thing that stops them is switching condition assignment off,
            after which requests are refused with{" "}
            <Code>CONDITION_ASSIGNMENT_NOT_ACTIVE</Code>.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              It is not recorded with each participant&apos;s data.
            </Text>{" "}
            DataPipe hands your experiment a number and forgets it. Save that
            number into the data you send if you want to know which condition a
            participant was in.
          </List.Item>
        </List.Root>
      </DocsSection>

      <DocsSection id="factorial-designs" title="Factorial designs">
        <Text maxW="70ch">
          If your design has multiple factors, set n to the total number of
          unique cells and map each number to the appropriate factor levels in
          your experiment code.
        </Text>
        <Text maxW="70ch">
          A 2 × 3 design is 6 conditions: request a number, then divide and take
          the remainder to recover each factor — for example{" "}
          <Code>Math.floor(condition / 3)</Code> for the two-level factor and{" "}
          <Code>condition % 3</Code> for the three-level one.
        </Text>
        <Text maxW="70ch">
          Because assignment is sequential, a factorial mapping stays balanced
          across complete runs of n participants, which is the main reason to
          prefer it over randomising in your own code.
        </Text>
      </DocsSection>
    </>
  );
}

ConditionAssignmentPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
