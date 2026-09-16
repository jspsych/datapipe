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
        purpose="How DataPipe gets permission to write to your storage, and what to do when that permission runs out."
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
          connect with one click. You approve DataPipe on their site, and from
          then on DataPipe manages the tokens for you, including refreshing
          them before they expire.
        </Text>
        <Text maxW="70ch">
          <Text as="span" fontWeight="semibold">
            Dataverse
          </Text>{" "}
          works differently. You create an API token on your
          institution&apos;s installation and paste it into DataPipe. That
          gives you direct control, but nothing can renew the token for you.
          When it expires, data stops arriving until you create a new one and
          reconnect. Either way, tokens are stored encrypted.
        </Text>
        <Text maxW="70ch">
          You connect, reconnect, and disconnect every provider from the{" "}
          <Text as="span" fontWeight="semibold">
            Storage Providers
          </Text>{" "}
          section of your{" "}
          <ProseLink href="/admin/account">account settings</ProseLink>. A
          green{" "}
          <Text as="span" fontWeight="semibold">
            Connected
          </Text>{" "}
          label tells you it worked.
        </Text>
      </DocsSection>

      <DocsSection id="google-drive" title="Google Drive">
        <Text maxW="70ch">
          Click Connect and Google&apos;s own sign-in page opens so you can
          authorize DataPipe. Then you come straight back.
        </Text>
        <Text maxW="70ch">
          DataPipe asks Google for a single permission,{" "}
          <Code>drive.file</Code>, which covers only the files and folders
          DataPipe itself creates. It can&apos;t open, list, or change
          anything else in your Drive, including files you later drag into the
          experiment folder by hand.
        </Text>
      </DocsSection>

      <DocsSection id="zenodo" title="Zenodo">
        <Text maxW="70ch">
          Click Connect and Zenodo opens so you can authorize DataPipe. Then
          you come straight back. DataPipe asks for permission to upload files
          to your depositions and to edit them. It never publishes a record,
          so nothing becomes public until you say so.
        </Text>
        <Text maxW="70ch">
          Which Zenodo you connect to depends on which DataPipe site
          you&apos;re using, not on the connection itself. The live site
          connects to zenodo.org, and the test site connects to the Zenodo
          sandbox.
        </Text>
      </DocsSection>

      <DocsSection id="dataverse" title="Dataverse">
        <Text maxW="70ch">
          For Dataverse, Connect opens a short form instead of sending you to
          another site. It asks for the full address of your
          institution&apos;s installation (for example,{" "}
          <Code>https://dataverse.harvard.edu</Code>) and an API token, which
          you create under the{" "}
          <Text as="span" fontWeight="semibold">
            API Token
          </Text>{" "}
          tab of your Dataverse account.
        </Text>
        <Text maxW="70ch">
          The address must be the plain <Code>https</Code> address of a named
          installation. DataPipe rejects anything else: no{" "}
          <Code>http</Code>, no username or password in the address, no
          non-standard port, no IP address, and no internal or single-word
          hostname. The reason is that DataPipe&apos;s server makes
          authenticated requests to whatever address you enter, so it has to
          be strict.
        </Text>
        <Text maxW="70ch">
          DataPipe checks the token against your installation before saving
          it. An expired or mistyped token is refused right when you paste it,
          not at the first participant&apos;s submission.
        </Text>
      </DocsSection>

      <DocsSection id="when-a-token-expires" title="When a token expires">
        <Text maxW="70ch">
          When the credential for an experiment&apos;s provider stops working,
          that experiment stops saving data. Submissions come back with{" "}
          <Code>PROVIDER_TOKEN_EXPIRED</Code> (&quot;The API token for this
          experiment&apos;s storage provider has expired. A new token must be
          created on that provider and reconnected to DataPipe&quot;), or with{" "}
          <Code>PROVIDER_NOT_CONNECTED</Code> if the connection was removed
          entirely. Data that arrives during a brief provider outage is queued
          and retried, but a retry can&apos;t fix an expired credential.
        </Text>
        <Text maxW="70ch" fontWeight="semibold">
          Google Drive and Zenodo renew themselves.
        </Text>
        <Text maxW="70ch">
          Google Drive access tokens are short-lived. DataPipe renews one on
          the next submission that needs it, and a sweep every Sunday at 02:00
          UTC renews any that are about to lapse. Zenodo tokens last about two
          months, and DataPipe renews one a few minutes before it expires, on
          the next submission that needs it. Neither needs anything from you.
        </Text>
        <Text maxW="70ch" fontWeight="semibold">
          Dataverse can&apos;t.
        </Text>
        <Text maxW="70ch">
          A Dataverse API token has no way to renew itself. It eventually
          expires, commonly a year after you create it, and only you can
          replace it. Dataverse doesn&apos;t show the expiry date anywhere in
          its own interface, so DataPipe reads it from your installation each
          time you create an experiment on Dataverse and shows the date on
          that form when the token expires within the next 60 days. The date
          comes from a message your installation writes in its own local time,
          so treat it as accurate to about a day and reconnect with room to
          spare.
        </Text>
      </DocsSection>

      <DocsSection id="reconnecting" title="Reconnecting">
        <Text maxW="70ch">
          A provider whose credential has expired still shows as connected.
          The connection exists, it just no longer works. So replacing it takes
          two steps in the{" "}
          <Text as="span" fontWeight="semibold">
            Storage Providers
          </Text>{" "}
          section of your{" "}
          <ProseLink href="/admin/account">account settings</ProseLink>:
          disconnect the provider, then connect it again.
        </Text>
        <Text maxW="70ch">
          For Google Drive and Zenodo, connecting again means approving
          DataPipe on their site once more. For Dataverse, create a fresh API
          token on your installation first, then connect with that token and
          the same server address.
        </Text>
        <Text maxW="70ch">
          Your experiments aren&apos;t affected. Each one keeps writing to the
          Drive folder, Dataverse dataset, or Zenodo deposition it already has.
          Submissions that failed while the credential was expired are retried
          automatically, as long as they haven&apos;t used up their five
          attempts, which takes about 31 hours from when they were queued.
        </Text>
        <Text maxW="70ch">
          If a one-click authorization never brings you back (say you left the
          tab sitting, or opened the link twice), start again from the account
          page. The link DataPipe hands to the provider works once and expires
          ten minutes after it&apos;s created.
        </Text>
        <GuidanceLine
          href="/docs/data/failures"
          linkText="When an upload fails"
        >
          What happens to submissions that arrived while the connection was
          broken, and how long you have to fix it.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="disconnecting" title="Disconnecting">
        <Text maxW="70ch">
          Disconnecting stops new data from reaching that provider. It never
          removes data already stored there.
        </Text>
        <Text maxW="70ch">
          The only thing it deletes is that provider&apos;s stored credential.
          Your other connections, your experiments, and everything already in
          your storage stay exactly as they are, and you can reconnect at any
          time. Before you disconnect, DataPipe tells you how many of your
          experiments send data to that provider, including ones that are
          currently paused.
        </Text>
        <Text maxW="70ch">
          A legacy OSF connection is the one exception. It isn&apos;t managed
          here and can&apos;t be disconnected from this screen.
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
