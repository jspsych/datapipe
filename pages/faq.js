import {
  Stack,
  Heading,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Text,
  OrderedList,
  ListItem,
  Link,
} from "@chakra-ui/react";
import NextLink from "next/link";

export default function FAQ() {
  return (
    <Stack maxW={800} w="100%" my={10}>
      <Heading as="h1" my={4}>
        FAQ
      </Heading>
      <Accordion defaultIndex={[0]} allowMultiple>
        <FAQItem question="How do I use this service?">
          <Text>
            DataPipe serves as a connection between an experiment and the Open
            Science Framework. To use DataPipe, you will need to use a webhost
            to get your experiment online (e.g., GitHub Pages) and then add some
            code to your experiment to send data to DataPipe. You will also need
            to have an OSF account to store the data and create an authorization
            token on the OSF to allow DataPipe to write data to your OSF
            account. Our{" "}
            <Link as={NextLink} href="/help">
              getting started guide
            </Link>{" "}
            has more information about how to use DataPipe.
          </Text>
        </FAQItem>
        <FAQItem question="Will this host my experiment?">
          <Text mb={2}>
            No, you will need to use a different service to make the experiment
            available online. The benefit of using this service is that you do
            not need to configure any of the backend/server components of an
            experiment, so you can use a provider like GitHub Pages to host the
            experiment for free.
          </Text>
          <Text>
            <Link isExternal href="https://pages.github.com/">
              This guide on GitHub Pages
            </Link>{" "}
            describes how to set up a free website using their service. In the
            guide, select &quot;project site&quot; and &quot;start from
            scratch&quot; and follow the guide to get an experiment hosted
            quickly.
          </Text>
        </FAQItem>
        <FAQItem question="Will this store my data?">
          <Text>
            Not directly. DataPipe helps you store your data on the Open Science
            Framework. When you use DataPipe, the data is routed through our
            service to (optionally) perform validation and then we send it to
            the OSF. DataPipe does not store a copy of the data.
          </Text>
        </FAQItem>
        <FAQItem question="How much does this cost?">
          <Text>DataPipe is free to use.</Text>
        </FAQItem>
        <FAQItem question="Why is this service free?">
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
        <FAQItem question="How much does this service cost to run?">
          <Text>
            We host DataPipe using Google Firebase, so the cost of DataPipe
            depends on how much usage it gets. Currently our resource
            consumption is less than $1 per month. Once we have been up and
            running for a while we will post more information about how much it
            costs to run the service. We have funding reserves in the{" "}
            <Link
              isExternal
              href="https://opencollective.com/jspsych#category-BUDGET"
            >
              Open Collective account for jsPsych development
            </Link>{" "}
            to sustain this serivce. Our goal is to provide transparent
            information about our costs and our available funds to run the
            service so you can determine whether we are likely to be able to
            keep the service running. We are grateful for donations to help keep
            the service running. If you{" "}
            <Link
              isExternal
              href="https://opencollective.com/jspsych#category-CONTRIBUTE"
            >
              donate a few dollars to our account
            </Link>{" "}
            you should cover the lifetime cost of providing this service to you.
          </Text>
        </FAQItem>
        <FAQItem question="Who can see the data that I collect using this service?">
          <Text>
            The data that you send to DataPipe are not stored anywhere on our
            servers and we do not log any information about the data when it is
            sent. If your OSF component that receives the data is private, then
            you have full control over who can see the data. If your OSF
            component is public, then anyone can see the data.
          </Text>
        </FAQItem>
        <FAQItem question="What are the risks of using this service and how can I mitigate them?">
          <Text mb={2}>
            There are a few risks that you should be aware of before using
            DataPipe.
          </Text>
          <OrderedList>
            <ListItem>
              In order to use this service you must provide us with an OSF
              authorization token so that we can write data to your OSF account
              on your behalf. This key enables full write access, so if we
              suffer a data breach it would be possible for someone who got
              access to the token to make malicious changes to your OSF account.
              To mitigate this risk, you should create an OSF token that is just
              for this service so that you can revoke authorization when you are
              done using the service. The strongest security would be to use an
              active token only when you need to collect data through this
              service.
            </ListItem>
            <ListItem>
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
            </ListItem>
            <ListItem>
              This service is not a commercial venture with a dedicated user
              support team. If something goes wrong, we may not be able to
              respond quickly. However, the{" "}
              <Link isExternal href="https://github.com/jspsych/datapipe">
                code that runs this service is open source
              </Link>{" "}
              and thoroughly tested. The service is hosted using the Google
              Cloud, so we get the benefit of Google&apos;s infrastructure to
              make sure the service is secure and keeps running.
            </ListItem>
          </OrderedList>
        </FAQItem>
      </Accordion>
    </Stack>
  );
}

function FAQItem({ question, children }) {
  return (
    <AccordionItem>
      <AccordionButton>
        <Heading as="h2" size="md" my={2} flex="1" textAlign="left">
          {question}
        </Heading>
        <AccordionIcon />
      </AccordionButton>
      <AccordionPanel pb={4} style={{ whiteSpace: "pre-line" }}>
        {children}
      </AccordionPanel>
    </AccordionItem>
  );
}
