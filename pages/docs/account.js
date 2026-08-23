import { Link as ChakraLink, List, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import PageHeader from "../../components/ui/PageHeader";
import GuidanceLine from "../../components/ui/GuidanceLine";
import DocsLayout from "../../components/docs/DocsLayout";
import DocsSection from "../../components/docs/DocsSection";

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

export default function AccountAndSecurityPage() {
  return (
    <>
      <PageHeader
        title="Account and security"
        purpose="How you sign in, how your credentials are stored, and what happens to your data if you delete your account."
      />

      <DocsSection id="sign-in-methods" title="Sign-in methods">
        <Text maxW="70ch">
          You can sign in to DataPipe with Google, ORCID, GitHub, or an email
          address and password. How you sign in has nothing to do with where
          your data goes: a Google sign-in does not give DataPipe access to your
          Google Drive, and connecting Google Drive does not change how you sign
          in.
        </Text>
        <Text maxW="70ch">
          One account can have several sign-in methods linked to it, and you add
          or remove them in your{" "}
          <ProseLink href="/admin/account">account settings</ProseLink>. Adding
          a second method is worth doing: it is what keeps you in the account
          that owns your experiments if you ever lose access to the first.
          DataPipe will not let you remove your only remaining method.
        </Text>
      </DocsSection>

      <DocsSection
        id="how-credentials-are-stored"
        title="How credentials are stored"
      >
        <Text maxW="70ch">
          DataPipe needs permission to write to your storage account, and all
          tokens are stored encrypted. For Google Drive and Zenodo you authorize
          DataPipe directly, and it manages and refreshes those tokens for you.
          For Dataverse you supply an API token, so create one specifically for
          DataPipe and revoke it when you are done collecting data. You can
          disconnect any provider from your account settings at any time.
        </Text>
        <Text maxW="70ch">
          Three details behind that, for anyone who needs them for an ethics
          application or a data management plan:
        </Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            Every stored credential — access tokens, refresh tokens and pasted
            API tokens alike — is encrypted with AES-256-GCM before it is
            written, and decrypted only in the server code that is about to make
            a request to your provider.
          </List.Item>
          <List.Item>
            Credentials live on your user record, and nothing running in a
            browser can write them: the database rules permit only the server to
            add or change a stored connection.
          </List.Item>
          <List.Item>
            The only credential that ever reaches your browser is a short-lived
            Google access token, handed over when you use the Drive folder
            picker to choose where an experiment&apos;s data should go. The
            refresh token behind it never leaves the server, and no other
            provider&apos;s credentials are sent to the browser at all.
          </List.Item>
        </List.Root>
      </DocsSection>

      <DocsSection
        id="disconnecting-a-provider"
        title="Disconnecting a provider"
      >
        <Text maxW="70ch">
          Disconnecting a provider deletes DataPipe&apos;s stored credential for
          it and stops new data from reaching it. It never removes data already
          stored there, and you can reconnect at any time.
        </Text>
        <GuidanceLine
          href="/docs/providers/connecting#disconnecting"
          linkText="Disconnecting"
        >
          What disconnecting affects, and what it leaves alone.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="deleting-your-account" title="Deleting your account">
        <Text maxW="70ch">
          Deleting your DataPipe account is permanent. It removes every
          experiment you own and everything DataPipe holds about them, and there
          is no way to recover them afterwards. It does not touch a single file
          in your storage provider.
        </Text>
        <Text maxW="70ch">
          You must have signed in within the last five minutes to delete an
          account. If it has been longer, DataPipe asks you to sign in again
          first — the same protection that stops a stolen session from
          destroying an account.
        </Text>
        <Text maxW="70ch">
          DataPipe deletes its own data first and your sign-in record last. If
          something fails partway, your account still exists and still owns
          everything that survived, so you can simply try again. Nothing is left
          stranded without an owner.
        </Text>
        <Text maxW="70ch" fontWeight="semibold">
          What is removed
        </Text>
        <List.Root maxW="70ch" gap={2} ps={6}>
          <List.Item>
            Every experiment you own, along with the record of which filenames
            it has used.
          </List.Item>
          <List.Item>
            Any submission still waiting to be uploaded, including files in the
            queue you have not downloaded.
          </List.Item>
          <List.Item>
            The metadata and log documents belonging to those experiments.
          </List.Item>
          <List.Item>
            Your user record, which is where your encrypted provider
            credentials live.
          </List.Item>
        </List.Root>
        <Text maxW="70ch" fontWeight="semibold">
          What is not removed
        </Text>
        <Text maxW="70ch">
          Nothing in your storage provider. Your Google Drive folders, Dataverse
          datasets, Zenodo depositions and OSF components all stay exactly as
          they are, in your own account, with everything DataPipe wrote to them.
          Deleting a DataPipe account removes DataPipe&apos;s ability to write
          to them, not the data itself.
        </Text>
        <GuidanceLine href="/docs/data" linkText="What DataPipe stores">
          What DataPipe holds while an experiment is running, and for how long.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

AccountAndSecurityPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
