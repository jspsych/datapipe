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
        purpose="How DataPipe assigns participants to conditions, and what it leaves for you to handle."
      />

      <DocsSection id="how-many-conditions" title="How many conditions">
        <Text maxW="70ch">
          DataPipe gives each participant the next number in a fixed sequence
          from 0 to n−1, where n is the number of conditions you set. With 3
          conditions, the sequence is 0, 1, 2, 0, 1, 2, and so on.
        </Text>
        <Text maxW="70ch">
          <strong>Set the number when you turn the switch on.</strong> A new
          experiment starts with one condition, and with one condition every
          participant gets 0 and the sequence never advances. The dashboard
          field won&apos;t go below 2, so for a multi-condition study you
          need to type the number in.
        </Text>
        <Text maxW="70ch">
          Behind the scenes, DataPipe keeps a single counter on the
          experiment. Each request returns the counter&apos;s current value and
          then advances it, wrapping back to 0 after n−1. Both steps happen in
          one transaction, so two participants who ask at the same moment
          always get different numbers.
        </Text>
        <Text maxW="70ch">
          Nothing resets the counter. Turning condition assignment off and on
          again picks up where it left off, and so does changing the number of
          conditions. If you lower n mid-study, the next participant may get a
          number that is now out of range, and the one after that starts again
          at 0. Change n before you recruit, not during.
        </Text>
        <GuidanceLine
          href="/docs/experiments/sending-data"
          linkText="Sending data from your experiment"
        >
          The code samples include a ready-made condition request for jsPsych
          and for plain JavaScript. It throws on failure rather than returning
          a value, so a participant is never quietly started on the wrong
          timeline.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="what-it-is-not" title="What it is not">
        <List.Root maxW="70ch" gap={3} ps={6}>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              It is not random assignment.
            </Text>{" "}
            The order is fixed and predictable. If your design needs
            randomization, randomize in your own experiment code and leave
            this switch off.
          </List.Item>
          <List.Item>
            <Text as="span" fontWeight="semibold">
              It does not re-balance.
            </Text>{" "}
            A participant who requests a condition and then closes the tab has
            still used up that number. The sequence moves on regardless. Over
            a study with dropouts, your cells won&apos;t end up exactly equal,
            so check the counts in your data rather than assuming them.
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
            DataPipe hands your experiment a number and forgets it. If you
            want to know which condition a participant was in, save that
            number into the data you send.
          </List.Item>
        </List.Root>
      </DocsSection>

      <DocsSection id="factorial-designs" title="Factorial designs">
        <Text maxW="70ch">
          If your design has more than one factor, set n to the total number
          of cells and map each number to a combination of factor levels in
          your experiment code.
        </Text>
        <Text maxW="70ch">
          A 2 × 3 design has 6 conditions. Request a number, then use division
          and the remainder to recover each factor:{" "}
          <Code>Math.floor(condition / 3)</Code> gives the two-level factor and{" "}
          <Code>condition % 3</Code> gives the three-level one.
        </Text>
        <Text maxW="70ch">
          Because assignment is sequential, a factorial mapping stays balanced
          across every complete run of n participants. That balance is the
          main reason to prefer it over randomizing in your own code.
        </Text>
      </DocsSection>
    </>
  );
}

ConditionAssignmentPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
