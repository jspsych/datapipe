import { Text } from "@chakra-ui/react";
import PageHeader from "../../components/ui/PageHeader";
import DocsLayout from "../../components/docs/DocsLayout";
import DocsSection from "../../components/docs/DocsSection";

const PLACEHOLDER = "Content for this section is not yet written.";

export default function AccountAndSecurityPage() {
  return (
    <>
      <PageHeader
        title="Account and security"
        purpose="How you sign in, how your credentials are stored, and what happens to your data if you delete your account."
      />

      <DocsSection id="sign-in-methods" title="Sign-in methods">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="how-credentials-are-stored" title="How credentials are stored">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="disconnecting-a-provider" title="Disconnecting a provider">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>

      <DocsSection id="deleting-your-account" title="Deleting your account">
        <Text color="fg.muted" maxW="70ch">{PLACEHOLDER}</Text>
      </DocsSection>
    </>
  );
}

AccountAndSecurityPage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
