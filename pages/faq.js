import {
  Stack,
  Heading,
  Accordion,
  Text,
  Link,
  Box,
} from "@chakra-ui/react";
import NextLink from "next/link";

export default function FAQ() {
  return (
    <Stack maxW={800} w="100%" my={10}>
      <Heading as="h1" my={4}>
        FAQ
      </Heading>
      <Accordion.Root defaultValue={["item-0"]} multiple collapsible>
        <FAQItem value="item-0" question="How do I use DataPipe?">
          <Text>
            Follow our{" "}
            <Link asChild>
              <NextLink href="/getting-started">getting started guide</NextLink>
            </Link>
            . In short: create an OSF project, link your OSF account to
            DataPipe, set up an experiment, and add a few lines of code to
            your study to send data through DataPipe to the OSF. The easiest
            way to get started is to sign in to DataPipe with your OSF
            account, which automatically authorizes DataPipe to write data
            on your behalf.
          </Text>
        </FAQItem>
        <FAQItem value="item-1" question="Will DataPipe host my experiment?">
          <Text mb={2}>
            No. You need a separate service to host your experiment online
            (e.g., GitHub Pages, Netlify, or university hosting). DataPipe
            only handles sending data to the OSF, so you do not need to
            configure any backend or server components yourself.
          </Text>
          <Text>
            <Link href="https://pages.github.com/" target="_blank" rel="noopener noreferrer">
              GitHub Pages
            </Link>{" "}
            is a free option. Select &quot;project site&quot; and &quot;start
            from scratch&quot; in their guide.
          </Text>
        </FAQItem>
        <FAQItem value="item-2" question="Will DataPipe store my data?">
          <Text>
            No. DataPipe routes your data to the Open Science Framework but
            does not keep a copy. Data passes through DataPipe for optional
            validation and is then sent directly to your OSF project.
          </Text>
        </FAQItem>
        <FAQItem value="item-3" question="How much does it cost?">
          <Text>DataPipe is free to use.</Text>
        </FAQItem>
        <FAQItem value="item-4" question="Why is DataPipe free?">
          <Text>
            The expensive parts of running an online experiment — hosting files
            and storing data — are handled by free services like GitHub Pages
            and the OSF. DataPipe is a lightweight bridge between them, which
            makes it inexpensive to operate.
          </Text>
        </FAQItem>
        <FAQItem value="item-5" question="How expensive is it to run DataPipe?">
          <Text>
            DataPipe is hosted on Google Firebase. Current resource consumption
            is less than $1 per month. The{" "}
            <Link
              href="https://opencollective.com/jspsych#category-BUDGET"
              target="_blank"
              rel="noopener noreferrer"
            >
              jsPsych Open Collective account
            </Link>{" "}
            has funding reserves to sustain the service, and we aim to keep
            costs and available funds transparent so you can judge the
            service&apos;s long-term viability. If you{" "}
            <Link
              href="https://opencollective.com/jspsych#category-CONTRIBUTE"
              target="_blank"
              rel="noopener noreferrer"
            >
              donate a few dollars
            </Link>
            , you will likely cover the lifetime cost of providing DataPipe
            to you.
          </Text>
        </FAQItem>
        <FAQItem value="item-6" question="Who can see the data I collect?">
          <Text>
            DataPipe does not store or log your data. Once data reaches your
            OSF project, visibility depends on your OSF settings. If the
            receiving component is private, only you and your collaborators
            can see the data. If it is public, anyone can.
          </Text>
        </FAQItem>
        <FAQItem value="item-7" question="What are the risks of using DataPipe?">
          <Text mb={2}>
            There are a few risks to be aware of:
          </Text>
          <ol style={{ paddingLeft: "1.5em" }}>
            <li style={{ marginBottom: "0.5em" }}>
              <strong>Authorization tokens.</strong> DataPipe needs permission
              to write to your OSF account. All tokens are stored encrypted.
              If you sign in with your OSF account, tokens are managed and
              refreshed automatically. If you use a personal access token
              instead, create one specifically for DataPipe and revoke it when
              you are done collecting data.
            </li>
            <li style={{ marginBottom: "0.5em" }}>
              <strong>Fake or spam data.</strong> As with any online experiment,
              a technically savvy user could submit fabricated data or spam
              files to your OSF project. DataPipe provides validation rules
              and session limits to reduce this risk.
            </li>
            <li>
              <strong>Support availability.</strong> DataPipe is not a
              commercial product with a dedicated support team. However,
              the{" "}
              <Link href="https://github.com/jspsych/datapipe" target="_blank" rel="noopener noreferrer">
                source code is open
              </Link>{" "}
              and thoroughly tested, and the service runs on Google Cloud
              infrastructure.
            </li>
          </ol>
        </FAQItem>
        <FAQItem value="item-8" question="How does data validation work?">
          <Text mb={2}>
            When enabled, DataPipe checks incoming data before sending it to
            the OSF. You can validate that files are well-formed JSON or CSV,
            and you can specify a list of required columns or fields that must
            be present. For JSON arrays (like jsPsych output), DataPipe checks
            whether the required fields appear in at least one object across
            the array.
          </Text>
          <Text>
            Invalid files are rejected and not sent to the OSF. Rejected data
            cannot be recovered. This feature is designed to block malicious
            submissions, not to catch errors in legitimate data.
          </Text>
        </FAQItem>
        <FAQItem value="item-9" question="How does base64 data collection work?">
          <Text mb={2}>
            Base64 data collection lets you send binary files — like audio
            recordings, video, or images — encoded as base64 strings. DataPipe
            decodes the string and stores the resulting file in your OSF
            project. Each request sends one file at a time.
          </Text>
          <Text>
            Validation is not currently supported for base64 data, so enabling
            this feature carries additional risk. We recommend keeping it
            active only while you are collecting data.
          </Text>
        </FAQItem>
        <FAQItem value="item-10" question="How does condition assignment work?">
          <Text>
            When enabled, DataPipe assigns condition numbers sequentially.
            It returns a number from 0 to n−1, where n is the number of
            conditions you configure. For example, with 3 conditions the
            sequence is 0, 1, 2, 0, 1, 2, and so on. If your design has
            multiple factors, set n to the total number of unique cells and
            map each number to the appropriate factor levels in your
            experiment code.
          </Text>
        </FAQItem>
        <FAQItem value="item-11" question="How does metadata production work?">
          <Text>
            When enabled, DataPipe generates a metadata file describing your
            data and its variables, following the{" "}
            <Link href="https://github.com/psych-ds/psych-DS" target="_blank" rel="noopener noreferrer">
              Psych-DS
            </Link>{" "}
            specification. The file is stored in your OSF project as
            dataset_description.json and is updated automatically after
            each session.
          </Text>
        </FAQItem>
        <FAQItem value="item-12" question="What is one-click authentication?">
          <Text mb={2}>
            One-click authentication lets you sign in to DataPipe with your
            OSF account. DataPipe then manages your authorization tokens
            automatically, including refreshing them when they expire. This
            is the recommended approach for most users.
          </Text>
          <Text>
            The alternative is a personal access token, which you create on
            the OSF and paste into DataPipe. This gives you direct control
            but requires you to manage the token yourself. Both methods store
            tokens encrypted.
          </Text>
        </FAQItem>
        <FAQItem value="item-13" question="How should I cite DataPipe?">
          <Text mb={2}>
            If you use DataPipe to collect data, please cite the following paper:
          </Text>
          <Text
            bg="gray.800"
            p={4}
            borderRadius="md"
            fontSize="sm"
          >
            de Leeuw, J. R. (2024). DataPipe: Born-open data collection for
            online experiments. <em>Behavior Research Methods</em>, 56(3),
            2499–2506.{" "}
            <Link
              href="https://doi.org/10.3758/s13428-023-02161-x"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://doi.org/10.3758/s13428-023-02161-x
            </Link>
          </Text>
        </FAQItem>
      </Accordion.Root>
    </Stack>
  );
}

function FAQItem({ question, children, value }) {
  return (
    <Accordion.Item value={value}>
      <Accordion.ItemTrigger>
        <Heading as="h2" size="md" my={2} flex="1" textAlign="left">
          {question}
        </Heading>
        <Accordion.ItemIndicator />
      </Accordion.ItemTrigger>
      <Accordion.ItemContent>
        <Box pb={4} style={{ whiteSpace: "pre-line" }}>
          {children}
        </Box>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
}
