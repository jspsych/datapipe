import { Code, Link as ChakraLink, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../../components/ui/PageHeader";
import GuidanceLine from "../../../components/ui/GuidanceLine";
import DocsLayout from "../../../components/docs/DocsLayout";
import DocsSection from "../../../components/docs/DocsSection";

// Prose link, per DESIGN.md §5: brandGreen.fg with a persistent underline, so
// a link is never signalled by color alone.
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

export default function ConnectingAndReconnectingPage() {
  return (
    <>
      <PageHeader
        title="Connecting and reconnecting"
        purpose="How DataPipe gets permission to write to your storage, and what to do when that permission lapses."
      />

      <DocsSection id="how-permission-works" title="How permission works">
        <Text maxW="70ch">
          <Text as="span" fontWeight="semibold">
            Google Drive
          </Text>{" "}
          and{" "}
          <Text as="span" fontWeight="semibold">
            Zenodo
          </Text>{" "}
          use a one-click authorization: you approve DataPipe on their site, and
          DataPipe then manages the resulting tokens for you, including
          refreshing them before they expire.
        </Text>
        <Text maxW="70ch">
          <Text as="span" fontWeight="semibold">
            Dataverse
          </Text>{" "}
          uses an API token that you create on your institution&apos;s
          installation and paste into DataPipe. That gives you direct control,
          but nothing can renew it for you: when the token expires, data stops
          arriving until you create a new one and reconnect. Tokens are stored
          encrypted either way.
        </Text>
        <Text maxW="70ch">
          You connect, reconnect and disconnect every provider from the{" "}
          <Text as="span" fontWeight="semibold">
            Storage Providers
          </Text>{" "}
          section of your{" "}
          <ProseLink href="/admin/account">account settings</ProseLink>. A green{" "}
          <Text as="span" fontWeight="semibold">
            Connected
          </Text>{" "}
          label confirms it worked.
        </Text>
      </DocsSection>

      <DocsSection id="google-drive" title="Google Drive">
        <Text maxW="70ch">
          Clicking Connect hands you to Google&apos;s own sign-in page to
          authorize DataPipe, then brings you straight back.
        </Text>
        <Text maxW="70ch">
          DataPipe asks Google for one permission,{" "}
          <Code>drive.file</Code>, which covers only the files and folders
          DataPipe itself creates. It cannot open, list or change anything else
          in your Drive, including files you later move into the experiment
          folder by hand.
        </Text>
      </DocsSection>

      <DocsSection id="zenodo" title="Zenodo">
        <Text maxW="70ch">
          Clicking Connect hands you to Zenodo to authorize DataPipe, then
          brings you straight back. DataPipe asks for permission to upload files
          to your depositions and to edit them; it never publishes a record, so
          nothing becomes public until you say so.
        </Text>
        <Text maxW="70ch">
          Which Zenodo installation you are connected to is fixed by this
          DataPipe deployment, not chosen per connection — the live site
          connects to zenodo.org, and the test site connects to the Zenodo
          sandbox.
        </Text>
      </DocsSection>

      <DocsSection id="dataverse" title="Dataverse">
        <Text maxW="70ch">
          Dataverse opens a short form instead of a redirect. It needs the full
          address of your institution&apos;s installation — for example,{" "}
          <Code>https://dataverse.harvard.edu</Code> — and an API token, which
          you create under the{" "}
          <Text as="span" fontWeight="semibold">
            API Token
          </Text>{" "}
          tab of your Dataverse account.
        </Text>
        <Text maxW="70ch">
          The address has to be the plain <Code>https</Code> address of a named
          installation. DataPipe rejects anything else — no{" "}
          <Code>http</Code>, no address with a username or password in it, no
          non-standard port, no IP address, and no internal or single-word
          hostname. That is because the DataPipe server itself makes
          authenticated requests to whatever you enter.
        </Text>
        <Text maxW="70ch">
          DataPipe checks the token against your installation before saving it,
          so an expired or mistyped token is refused at the point you paste it
          rather than at the first participant&apos;s submission.
        </Text>
      </DocsSection>

      <DocsSection id="when-a-token-expires" title="When a token expires">
        <Text maxW="70ch">
          When the credential for an experiment&apos;s provider is no longer
          usable, that experiment stops saving data. Submissions come back with{" "}
          <Code>PROVIDER_TOKEN_EXPIRED</Code> — &quot;The API token for this
          experiment&apos;s storage provider has expired. A new token must be
          created on that provider and reconnected to DataPipe&quot; — or with{" "}
          <Code>PROVIDER_NOT_CONNECTED</Code> if the connection was removed
          entirely. Data that arrives during a temporary provider failure is
          queued and retried; a lapsed credential is not something a retry can
          fix.
        </Text>
        <Text maxW="70ch" fontWeight="semibold">
          Google Drive and Zenodo renew themselves.
        </Text>
        <Text maxW="70ch">
          Google Drive access tokens are short-lived. DataPipe renews one on
          the next submission that needs it, and a sweep every Sunday at 02:00
          UTC renews any that are about to lapse. Zenodo tokens last about two
          months, and DataPipe renews one on the next submission that needs it,
          a few minutes ahead of expiry. Neither needs anything from you.
        </Text>
        <Text maxW="70ch" fontWeight="semibold">
          Dataverse cannot.
        </Text>
        <Text maxW="70ch">
          A Dataverse API token has no renewal mechanism, so it eventually
          expires — commonly a year after you create it — and only you can
          replace it. DataPipe reads the expiry date from your installation each
          time you create an experiment on Dataverse, and names the date on that
          form when the token expires in the next 60 days. Dataverse does not
          show the expiry anywhere in its own interface, which is why DataPipe
          reports it. The date comes from a message your installation writes in
          its own local time, so treat it as accurate to about a day and
          reconnect with room to spare.
        </Text>
      </DocsSection>

      <DocsSection id="reconnecting" title="Reconnecting">
        <Text maxW="70ch">
          A provider whose credential has lapsed still shows as connected —
          the connection exists, it just no longer works — so replacing it is a
          two-step action in the{" "}
          <Text as="span" fontWeight="semibold">
            Storage Providers
          </Text>{" "}
          section of your{" "}
          <ProseLink href="/admin/account">account settings</ProseLink>:
          disconnect the provider, then connect it again.
        </Text>
        <Text maxW="70ch">
          For Google Drive and Zenodo, connecting again means approving DataPipe
          on their site once more. For Dataverse, create a fresh API token on
          your installation first, then connect with that token and the same
          server address.
        </Text>
        <Text maxW="70ch">
          Your experiments are unaffected. Each one keeps writing to the Drive
          folder, Dataverse dataset, or Zenodo deposition it already has, and
          submissions that failed while the credential was lapsed are retried
          automatically — as long as they have not already used up their five
          attempts, which takes about 31 hours from when they were queued.
        </Text>
        <Text maxW="70ch">
          If a one-click authorization does not come back — you left the tab
          sitting, or opened the link twice — start it again from the account
          page. The link DataPipe hands to the provider works once, and expires
          ten minutes after it is created.
        </Text>
        <GuidanceLine
          href="/docs/data/failures"
          linkText="When an upload fails"
        >
          What happens to the submissions that arrived while the connection was
          broken, and how long you have to fix it.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="disconnecting" title="Disconnecting">
        <Text maxW="70ch">
          Disconnecting stops new data from reaching that provider. It never
          removes data already stored there.
        </Text>
        <Text maxW="70ch">
          All it deletes is that provider&apos;s stored credential. Your other
          connections, your experiments, and everything already written to your
          storage stay exactly as they are, and you can reconnect at any time.
          Before you disconnect, DataPipe tells you how many of your experiments
          send data to that provider, including ones whose collection is
          currently paused.
        </Text>
        <Text maxW="70ch">
          A legacy OSF connection is the exception: it is not managed here, and
          it cannot be disconnected from this screen.
        </Text>
        <GuidanceLine href="/docs/account" linkText="Account and security">
          Where credentials are stored, and what deleting your account removes.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

ConnectingAndReconnectingPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
