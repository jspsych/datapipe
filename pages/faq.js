import {
  Stack,
  Heading,
  Accordion,
  Text,
  Link,
  Box,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { useState, useEffect } from "react";
import { osfSunsetLabel } from "../lib/osf-sunset";

export default function FAQ() {
  const [openItems, setOpenItems] = useState(["item-0"]);
  // Read from lib/osf-sunset.js rather than restated here, so this answer, the
  // dashboard banners and the getting-started guide can never disagree about
  // the date. Tolerates a null date the same way they do.
  const osfDeadline = osfSunsetLabel();

  useEffect(() => {
    function scrollToHash() {
      const hash = window.location.hash.replace("#", "");
      if (!hash) return;
      setOpenItems((prev) => (prev.includes(hash) ? prev : [...prev, hash]));
      // Each FAQItem owns a Box with id={value} that isn't part of the
      // collapsible content, so it's always in the DOM to target — no need to
      // wait on the accordion's expand animation. Offset for the fixed navbar.
      requestAnimationFrame(() => {
        const el = document.getElementById(hash);
        if (!el) return;
        const top = el.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: "smooth" });
      });
    }

    scrollToHash();
    // Also handle hash changes while already on this page (e.g. clicking
    // another #item-N link without a full navigation/mount).
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  return (
    <Stack maxW={800} w="100%" my={10}>
      <Heading as="h1" my={4}>
        FAQ
      </Heading>
      <Accordion.Root value={openItems} onValueChange={(e) => setOpenItems(e.value)} multiple collapsible>
        <FAQItem value="item-0" question="How do I use DataPipe?">
          <Text>
            Follow our{" "}
            <Link asChild>
              <NextLink href="/getting-started">getting started guide</NextLink>
            </Link>
            . In short: connect a storage provider — Google Drive,
            Dataverse, or Zenodo — to your DataPipe account, create an
            experiment, and add a few lines of code to your study to send data
            through DataPipe to that provider. Google Drive and Zenodo connect
            in one click; Dataverse asks for an API token from your
            institution&apos;s installation.
          </Text>
        </FAQItem>
        <FAQItem value="item-0b" question="I collect data on OSF. What happens now?">
          <Text mb={2}>
            OSF is shutting down its projects feature, so DataPipe can no
            longer create new experiments there.{" "}
            {osfDeadline
              ? `Experiments already collecting keep running until ${osfDeadline}, after which DataPipe stops writing to OSF.`
              : "Experiments already collecting keep running for now."}
          </Text>
          <Text mb={2}>
            Data already on OSF is unaffected. It stays in your OSF account,
            and DataPipe never removes it.
          </Text>
          <Text>
            To keep collecting, connect Google Drive, Dataverse, or Zenodo in
            your{" "}
            <Link asChild>
              <NextLink href="/admin/account">account settings</NextLink>
            </Link>
            , create a new experiment on that provider, and point your study
            at the new experiment ID. Your existing data does not move, so it
            is worth finishing a study on OSF if you are close to done rather
            than switching mid-collection.
          </Text>
        </FAQItem>
        <FAQItem value="item-1" question="Will DataPipe host my experiment?">
          <Text mb={2}>
            No. You need a separate service to host your experiment online
            (e.g., GitHub Pages, Netlify, or university hosting). DataPipe
            only handles sending data to your storage provider, so you do not
            need to configure any backend or server components yourself.
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
          <Text mb={2}>
            Under normal operation, no. DataPipe routes your data to the
            storage provider you connected but does not keep a copy. Data
            passes through DataPipe for optional validation and then goes
            straight to your Drive folder, Dataverse dataset, or Zenodo
            deposition.
          </Text>
          <Text>
            The one exception is when an upload fails (for example, because
            your provider is briefly unavailable or rate-limits us). In that
            case, DataPipe temporarily caches the data so it can retry the upload
            automatically. Cached data is encrypted at rest, stored for up to
            one week, and deleted as soon as the upload succeeds. See the
            question below for details.
          </Text>
        </FAQItem>
        <FAQItem value="item-2b" question="What happens if an upload fails?">
          <Text mb={2}>
            If your storage provider is temporarily unavailable or returns an
            error, DataPipe will not lose your data. Failed uploads are
            automatically cached and retried with increasing intervals
            (starting at one hour, up to 24 hours) for up to five attempts
            over approximately one week.
          </Text>
          <Text mb={2}>
            Your experiment dashboard will show an orange badge for pending
            retries or a red badge if all retries have been exhausted. You can
            expand the queued files panel to see the status of each file,
            including the reason for failure and the number of retry attempts.
          </Text>
          <Text>
            You can also download any cached file directly from the dashboard
            at any time, so you always have a way to recover your data even if
            the automatic retries do not succeed.
          </Text>
        </FAQItem>
        <FAQItem
          value="item-2c"
          question="Can I add or remove files myself while data collection is running?"
        >
          <Text mb={2}>
            Please don&apos;t. While an experiment is active, treat its storage
            location as belonging to DataPipe: let DataPipe write to it, and
            download from it as much as you like, but avoid uploading, renaming,
            or deleting files there yourself until collection is finished.
          </Text>
          <Text mb={2}>
            DataPipe keeps its own record of which filenames it has already used,
            so that a participant who submits twice cannot overwrite existing
            data. Files that appear without DataPipe writing them are missing
            from that record. Depending on the storage provider, the next
            submission that happens to use the same name may then be silently
            renamed or may overwrite what you added.
          </Text>
          <Text>
            On providers with a limit on how many files one project can hold —
            Zenodo allows 100 — DataPipe combines older sessions into archives to
            stay under it. Files added by hand count toward that limit, and can
            fill the project faster than DataPipe expects.
          </Text>
        </FAQItem>
        <FAQItem value="item-3" question="How much does it cost?">
          <Text>DataPipe is free to use.</Text>
        </FAQItem>
        <FAQItem value="item-4" question="Why is DataPipe free?">
          <Text>
            The expensive parts of running an online experiment — hosting files
            and storing data — are handled by services you already have access
            to, like GitHub Pages for hosting and Google Drive, Dataverse, or
            Zenodo for storage. DataPipe is a lightweight bridge between them,
            which makes it inexpensive to operate.
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
            storage provider, visibility is governed entirely by that
            provider&apos;s own sharing settings. A Google Drive folder is
            private until you share it. A Zenodo deposition stays a private
            draft until you publish it. A Dataverse dataset stays a draft
            until you publish it, and its access is then set by your
            installation&apos;s policies. In every case DataPipe changes
            nothing about who can see your data — you do.
          </Text>
        </FAQItem>
        <FAQItem value="item-7" question="What are the risks of using DataPipe?">
          <Text mb={2}>
            There are a few risks to be aware of:
          </Text>
          <ol style={{ paddingLeft: "1.5em" }}>
            <li style={{ marginBottom: "0.5em" }}>
              <strong>Authorization tokens.</strong> DataPipe needs permission
              to write to your storage account, and all tokens are stored
              encrypted. For Google Drive and Zenodo you authorize DataPipe
              directly, and it manages and refreshes those tokens for you. For
              Dataverse you supply an API token, so create one specifically for
              DataPipe and revoke it when you are done collecting data. You can
              disconnect any provider from your account settings at any time.
            </li>
            <li style={{ marginBottom: "0.5em" }}>
              <strong>Fake or spam data.</strong> As with any online experiment,
              a technically savvy user could submit fabricated data or spam
              files to your storage. DataPipe provides validation rules and
              session limits to reduce this risk.
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
            When enabled, DataPipe checks incoming data before sending it on
            to your storage provider. You can validate that files are
            well-formed JSON or CSV,
            and you can specify a list of required columns or fields that must
            be present. For JSON arrays (like jsPsych output), DataPipe checks
            whether the required fields appear in at least one object across
            the array.
          </Text>
          <Text>
            Invalid files are rejected and never sent to your storage
            provider. Rejected data cannot be recovered. This feature is designed to block malicious
            submissions, not to catch errors in legitimate data.
          </Text>
        </FAQItem>
        <FAQItem value="item-9" question="How does base64 data collection work?">
          <Text mb={2}>
            Base64 data collection lets you send binary files — like audio
            recordings, video, or images — encoded as base64 strings. DataPipe
            decodes the string and stores the resulting file alongside the rest
            of your experiment&apos;s data. Each request sends one file at a
            time.
          </Text>
          <Text>
            Validation is not currently supported for base64 data, so enabling
            this feature carries additional risk. We recommend keeping it
            active only while you are collecting data.
          </Text>
        </FAQItem>
        <FAQItem value="item-9b" question="Is there a limit on how much data I can send?">
          <Text mb={2}>
            Yes. DataPipe has a <strong>32 MB limit</strong> on the size of a
            single request. This limit is enforced by the server infrastructure
            and cannot be increased. Most experiment data is well under this
            limit — a typical jsPsych dataset is 50 KB to 5 MB.
          </Text>
          <Text mb={2}>
            If you are using version 0.6.0 or later of the{" "}
            <Link
              href="https://github.com/jspsych/jspsych-contrib/tree/main/packages/plugin-pipe"
              target="_blank"
              rel="noopener noreferrer"
            >
              @jspsych-contrib/plugin-pipe
            </Link>{" "}
            plugin, request bodies are automatically compressed with gzip before
            sending. Text data (JSON, CSV) typically compresses by 2–10x, which
            effectively raises the upload limit to roughly 60–300 MB for most
            experiment data. Compression is enabled by default and requires no
            configuration.
          </Text>
          <Text mb={2}>
            Compression is less effective for binary data sent via the base64
            endpoint (e.g., video or audio recordings), because binary data does
            not compress as well as text. If you need to send individual files
            larger than about 25 MB through the base64 endpoint, they may still
            exceed the limit even after compression.
          </Text>
          <Text>
            If you are sending data without the plugin (e.g., using fetch
            directly), you can compress the request body yourself using the
            browser&apos;s{" "}
            <Link
              href="https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream"
              target="_blank"
              rel="noopener noreferrer"
            >
              CompressionStream API
            </Link>{" "}
            and setting the <code>Content-Encoding: gzip</code> header. The
            server will decompress the body automatically.
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
          <Text mb={2}>
            When enabled, DataPipe generates a dataset_description.json file
            alongside your data that describes the dataset and its variables
            according to the Psych-DS specification. The file is updated
            automatically as new sessions are uploaded.
          </Text>
          <Text mb={2}>
            For each variable, DataPipe records its data type and, when
            available, a human-readable description from the relevant jsPsych
            plugin documentation. It also combines information across sessions,
            such as observed numeric ranges and categorical values.
          </Text>
          <Text>
            Metadata production is recommended when you plan to share or publish
            your data because it makes the dataset easier to understand and
            reuse. You can enable it from your experiment dashboard. See the{" "}
            <Link asChild textDecoration="underline">
              <NextLink href="/getting-started">getting started guide</NextLink>
            </Link>{" "}
            for setup instructions, or visit the{" "}
            <Link href="https://psychds-docs.readthedocs.io/en/latest/" target="_blank" rel="noopener noreferrer" textDecoration="underline">
              Psych-DS documentation
            </Link>{" "}
            to learn more.
          </Text>
        </FAQItem>
        <FAQItem value="item-12" question="How does DataPipe get permission to write to my storage?">
          <Text mb={2}>
            It depends on the provider. <strong>Google Drive</strong> and{" "}
            <strong>Zenodo</strong> use a one-click authorization: you approve
            DataPipe on their site, and DataPipe then manages the resulting
            tokens for you, including refreshing them before they expire.
          </Text>
          <Text>
            <strong>Dataverse</strong> uses an API token that you create on
            your institution&apos;s installation and paste into DataPipe. That
            gives you direct control, but nothing can renew it for you: when
            the token expires, data stops arriving until you create a new one
            and reconnect. Tokens are stored encrypted either way, and you can
            disconnect a provider at any time from your account settings.
          </Text>
        </FAQItem>
        <FAQItem value="item-13" question="How should I cite DataPipe?">
          <Text mb={2}>
            If you use DataPipe to collect data, please cite the following paper:
          </Text>
          <Text
            // Recessed prose citation block, not code -- bg.subtle (DESIGN.md
            // §1: "Recessed: code blocks, table headers"). No color prop
            // needed: body text inherits the page's neutral `fg`, which
            // clears 4.5:1 on bg.subtle in both modes.
            bg="bg.subtle"
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
    <Box id={value}>
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
    </Box>
  );
}
