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
            DataPipe serves as a connection between an experiment and the Open
            Science Framework. To use DataPipe, you will need to use a webhost
            to get your experiment online (e.g., GitHub Pages) and then add some
            code to your experiment to send data to DataPipe. You will also need
            an OSF account to store the data. The recommended way to get started
            is to sign in to DataPipe with your OSF account, which automatically
            authorizes DataPipe to write data to the OSF on your behalf.
            Alternatively, you can create a personal access token on the OSF.
            Our{" "}
            <Link asChild>
              <NextLink href="/getting-started">getting started guide</NextLink>
            </Link>{" "}
            has more information about how to use DataPipe.
          </Text>
        </FAQItem>
        <FAQItem value="item-1" question="Will DataPipe host my experiment?">
          <Text mb={2}>
            No, you will need to use a different service to make the experiment
            available online. The benefit of using this service is that you do
            not need to configure any of the backend/server components of an
            experiment, so you can use a provider like GitHub Pages to host the
            experiment for free.
          </Text>
          <Text>
            <Link href="https://pages.github.com/" target="_blank" rel="noopener noreferrer">
              This guide on GitHub Pages
            </Link>{" "}
            describes how to set up a free website using their service. In the
            guide, select &quot;project site&quot; and &quot;start from
            scratch&quot; and follow the guide to get an experiment hosted
            quickly.
          </Text>
        </FAQItem>
        <FAQItem value="item-2" question="Will DataPipe store my data?">
          <Text>
            Not directly. DataPipe helps you store your data on the Open Science
            Framework. When you use DataPipe, the data is routed through our
            service to (optionally) perform validation and then we send it to
            the OSF. DataPipe does not store a copy of the data.
          </Text>
        </FAQItem>
        <FAQItem value="item-3" question="How much does it cost?">
          <Text>DataPipe is free to use.</Text>
        </FAQItem>
        <FAQItem value="item-4" question="Why is DataPipe free?">
          <Text>
            The expensive parts of hosting an experiment are providing storage
            and bandwidth for the experiment files and data. Fortunately there
            are providers who are willing to do both of these things for free.
            GitHub (and others) will host a website for free and the Open
            Science Framework will store data for free. Unfortunately these
            providers are not directly connected to each other, so that is what
            we are trying to solve. DataPipe is a very lightweight (i.e., cheap)
            service that makes it easy to link a hosting provider with a data
            storage provider.
          </Text>
        </FAQItem>
        <FAQItem value="item-5" question="How expensive is it to run DataPipe?">
          <Text>
            We host DataPipe using Google Firebase, so the cost of DataPipe
            depends on how much usage it gets. Currently our resource
            consumption is less than $1 per month. Once we have been up and
            running for a while we will post more information about how much it
            costs to run the service. We have funding reserves in the{" "}
            <Link
              href="https://opencollective.com/jspsych#category-BUDGET"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Collective account for jsPsych development
            </Link>{" "}
            to sustain this serivce. Our goal is to provide transparent
            information about our costs and our available funds to run the
            service so you can determine whether we are likely to be able to
            keep the service running. We are grateful for donations to help keep
            the service running. If you{" "}
            <Link
              href="https://opencollective.com/jspsych#category-CONTRIBUTE"
              target="_blank"
              rel="noopener noreferrer"
            >
              donate a few dollars to our account
            </Link>{" "}
            you should cover the lifetime cost of providing this service to you.
          </Text>
        </FAQItem>
        <FAQItem value="item-6" question="Who can see the data that I collect using DataPipe?">
          <Text>
            The data that you send to DataPipe are not stored anywhere on our
            servers and we do not log any information about the data when it is
            sent. If your OSF component that receives the data is private, then
            you have full control over who can see the data. If your OSF
            component is public, then anyone can see the data.
          </Text>
        </FAQItem>
        <FAQItem value="item-7" question="What are the risks of using DataPipe and how can I mitigate them?">
          <Text mb={2}>
            There are a few risks that you should be aware of before using
            DataPipe.
          </Text>
          <ol style={{ paddingLeft: "1.5em" }}>
            <li style={{ marginBottom: "0.5em" }}>
              In order to use this service you must authorize DataPipe to write
              data to your OSF account on your behalf. All tokens are stored
              encrypted. If you sign in with your OSF account, DataPipe also
              manages your tokens automatically and refreshes them regularly,
              which further reduces the risk of exposure. If you use a personal
              access token instead, this key enables full write access. To
              mitigate this risk, you should create an OSF token that is just
              for this service so that you can revoke authorization when you are
              done using the service. The strongest security would be to use an
              active token only when you need to collect data through this
              service.
            </li>
            <li style={{ marginBottom: "0.5em" }}>
              This service does allow a technically savvy user to potentially
              write fake data to your OSF project. This is almost always a risk
              with online experiments because the data are usually recorded on
              the participant&apos;s computer before being sent to the server.
              It is possible for a malicious user to change or create the data
              before sending it to the service. It is also possible that a user
              could spam data to your OSF account or could send files that are
              not actually experiment data. We provide tools to mitigate these
              risks by allowing you to specify validation rules for the data
              that is sent and to rate limit the amount of data you are
              receiving.
            </li>
            <li>
              This service is not a commercial venture with a dedicated user
              support team. If something goes wrong, we may not be able to
              respond quickly. However, the{" "}
              <Link href="https://github.com/jspsych/datapipe" target="_blank" rel="noopener noreferrer">
                code that runs this service is open source
              </Link>{" "}
              and thoroughly tested. The service is hosted using the Google
              Cloud, so we get the benefit of Google&apos;s infrastructure to
              make sure the service is secure and keeps running.
            </li>
          </ol>
        </FAQItem>
        <FAQItem value="item-8" question="How does data validation work?">
          <Text mb={2}>
            DataPipe has an optional feature that will validate any incoming
            data before sending it to the OSF. Currently, this feature supports
            checking whether an incoming file is valid JSON or CSV data (meaning
            that it has the correct format) and it allows you to specify a set
            of columns/fields that the data must contain. For CSV data, the
            validation simply checks if all of the required columns are in the
            header row. For JSON data, the validation checks if all of the
            required fields are present in at least one object in the data. For
            example, if the data are an array of trials (as jsPsych generates),
            then this validation will generate a list of all of the unique
            fields that are present in any of the trials and then check if all
            of the required fields are present. This is equivalent to converting
            the data to CSV format and then checking if all of the required
            columns are present.
          </Text>
          <Text>
            If an invalid data file is sent, it will be rejected and not sent to
            the OSF. There is no way to recover this data. This feature is not
            designed to catch errors in legitimate data files. It is designed to
            prevent malicious users from sending non-data files to your OSF
            project.
          </Text>
        </FAQItem>
        <FAQItem value="item-9" question="How does base 64 data collection work?">
          <Text mb={2}>
            DataPipe has an optional feature that will collect data as base 64
            encoded strings. This is useful if you want to collect data that is
            not text-based, like JSON or CSV. This feature is designed to
            collect a single file of data at a time. For example, if you are
            running an experiment where the participant will record several
            audio files, you could use this feature to send each file to the OSF
            as it is recorded. When DataPipe gets a base 64 encoded file, it
            will decode it and then send it to the OSF as a file.
          </Text>
          <Text>
            Note that validating base 64 encoded data is not currently
            supported, so enabling this feature does create additional risk. We
            recommend minimizing this risk by enabling the feature only when you
            are actively collecting data and disabling it when you are not.
          </Text>
        </FAQItem>
        <FAQItem value="item-10" question="How does condition assignment work?">
          <Text>
            When you enable condition assignment, you can call an API endpoint
            to get the next condition for a participant. DataPipe will send you
            a number between 0 and n-1, where n is the number of conditions you
            set in your experiment. If you have an experimental design with
            multiple factors, set the number of conditions to the number of
            unique cells in your design, and then use the condition number to
            determine the appropriate level of each factor. DataPipe generates
            condition numbers sequentially, so if you have 3 conditions, the
            first participant will get condition 0, the second participant will
            get condition 1, the third participant will get condition 2, and
            then the cycle will repeat.
          </Text>
        </FAQItem>
        <FAQItem value="item-11" question="How does metadata production work?">
          <Text>
            When you enable metadata production, DataPipe will use the data from
            your experiment to create a metadata file that describes the data and
            its variables. This metadata file is generated according to {" "}
              <Link href="https://github.com/psych-ds/psych-DS" target="_blank" rel="noopener noreferrer">
                Psych-DS
              </Link>{" "}
            and stored in OSF as dataset_description.json. With every subsequent
            session, DataPipe will update the metadata as necessary.
          </Text>
        </FAQItem>
        <FAQItem value="item-12" question="What is one-click authentication and how is it different from a personal access token?">
          <Text mb={2}>
            One-click authentication lets you sign in to DataPipe using your OSF
            account. When you do this, DataPipe automatically manages your
            authorization tokens so you do not need to create or paste a token
            manually. Your tokens are refreshed automatically.
          </Text>
          <Text>
            A personal access token is a token that you create manually on the
            OSF and paste into DataPipe. This gives you more direct control over
            the token, but you are responsible for creating and revoking it
            yourself. Both methods store tokens encrypted. We recommend
            one-click authentication for most users because it is simpler and
            handles token refresh automatically.
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

