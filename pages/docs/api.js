import { Text, Table, Code, Box, Heading, Link as ChakraLink } from "@chakra-ui/react";
import PageHeader from "../../components/ui/PageHeader";
import GuidanceLine from "../../components/ui/GuidanceLine";
import CodeBlock from "../../components/CodeBlock";
import DocsLayout from "../../components/docs/DocsLayout";
import DocsSection from "../../components/docs/DocsSection";
import {
  EndpointHeading,
  ParamTable,
  Param,
  ErrorRow,
} from "../../components/docs/ApiPrimitives";

// Prose link, per DESIGN.md 5: brandGreen.fg with a persistent underline, so a
// link is never signalled by color alone. Local to this page for the same
// reason pages/docs/experiments/sending-data.js keeps its own -- there is no
// shared prose-link primitive yet.
function ProseLink({ href, external, children }) {
  return (
    <ChakraLink
      href={href}
      color="brandGreen.fg"
      textDecoration="underline"
      textUnderlineOffset="2px"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </ChakraLink>
  );
}

export default function ApiReferencePage() {
  return (
    <>
      <PageHeader
        title="API reference"
        purpose="Every endpoint your experiment can call, what it returns, and the limits every request runs under."
      />

      <Text maxW="70ch">
        All endpoints accept JSON request bodies with{" "}
        <Code>Content-Type: application/json</Code>. You&apos;ll need an
        experiment ID, which DataPipe assigns when you create your experiment.
        Code examples for jsPsych and JavaScript are on each experiment&apos;s
        dashboard.
      </Text>
      <Text maxW="70ch" mt={4}>
        The API is the same whichever storage provider an experiment uses.
        DataPipe routes each submission to that experiment&apos;s own
        destination (a Google Drive folder, a Dataverse dataset, or a Zenodo
        deposition), so your experiment code never names a provider.
      </Text>

      <DocsSection id="limits" title="Limits">
        <Text maxW="70ch">
          Three limits apply to every request, and none of them can be
          changed per experiment.
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>32 MB per request.</strong> Enforced by the server
            infrastructure and not adjustable. A typical jsPsych dataset is 50
            KB to 5 MB, so this mainly matters for base64 media. Gzipped
            request bodies are decompressed transparently, which in practice
            raises the ceiling for text data.
          </Box>
          <Box as="li" mb={2}>
            <strong>60 seconds per request.</strong> Every <Code>/api/*</Code>{" "}
            path runs behind a hosting layer with a hard 60-second ceiling.
            That&apos;s why <Code>/api/finalize</Code> returns immediately and
            finishes its work in the background instead of waiting for the
            job to end.
          </Box>
          <Box as="li" mb={2}>
            <strong>JSON bodies only.</strong> Send{" "}
            <Code>Content-Type: application/json</Code>. The three participant
            endpoints don&apos;t check the HTTP method, so a request sent with
            the wrong verb arrives with an empty body and comes back as{" "}
            <Code>MISSING_PARAMETER</Code> rather than <Code>405</Code>. The
            two authenticated endpoints below do check, and answer{" "}
            <Code>405</Code>.
          </Box>
        </Box>
        <GuidanceLine
          href="/docs/experiments/sending-data#request-size-limits"
          linkText="Request size limits"
        >
          Compressing a request body yourself, and what the size limit means in
          practice.
        </GuidanceLine>
        <GuidanceLine
          href="/docs/experiments/streaming#limits"
          linkText="Save-as-you-go limits"
        >
          The trial size, session, abandonment, and file-size limits that apply
          only to incremental sessions.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="save-text-data" title="Save text data">
        <EndpointHeading method="POST" path="/api/data/">
          Save text data
        </EndpointHeading>
        <Text maxW="70ch">
          Save a text file (CSV, JSON, etc.) to your experiment&apos;s storage.
          If you have validation rules set up, DataPipe checks the data before
          sending it on.
        </Text>
        <Box overflowX="auto" w="100%">
          <ParamTable>
            <Param name="experimentID" type="string">
              Your experiment ID, found on the experiment dashboard.
            </Param>
            <Param name="filename" type="string">
              Name for the stored file (e.g., <Code>subject01.csv</Code>). Must
              be unique, or the request fails.
            </Param>
            <Param name="data" type="string">
              The file contents as a string.
            </Param>
            <Param name="sessionId" type="string (optional)">
              The session returned by <Code>/api/session/</Code>, if this
              experiment staged its trials as it went. It carries no data of
              its own. The <Code>data</Code> field above is still the
              submission. It only tells DataPipe which staged copy this
              request replaces, so DataPipe can discard it.
            </Param>
          </ParamTable>
        </Box>
        <Box>
          <Text fontSize="sm" color="fg.muted" mb={2}>
            Example request body
          </Text>
          <CodeBlock>
            {`{
  "experimentID": "abc123",
  "filename": "subject01.csv",
  "data": "rt,response\\n204,1\\n389,0"
}`}
          </CodeBlock>
        </Box>
      </DocsSection>

      <DocsSection id="start-session" title="Start an incremental session">
        <EndpointHeading method="POST" path="/api/session/">
          Start an incremental session
        </EndpointHeading>
        <Text maxW="70ch">
          Open a session so an experiment can send trials as they happen,
          rather than only at the end. A participant who abandons the
          experiment partway through then leaves behind a recoverable partial
          session instead of nothing at all.
        </Text>
        <Text maxW="70ch">
          You won&apos;t usually call this yourself. The{" "}
          <ProseLink
            href="https://github.com/jspsych/jsPsych/tree/main/packages/extension-pipe"
            external
          >
            @jspsych/extension-pipe extension
          </ProseLink>{" "}
          calls it by default, along with the staging writes that follow, and{" "}
          <ProseLink
            href="https://github.com/jspsych/datapipe/tree/main/packages/client"
            external
          >
            datapipe-client
          </ProseLink>{" "}
          does the same when a plain JavaScript experiment starts a session
          with it. It&apos;s documented here
          because those writes go to a Firebase Realtime Database rather than
          to this API, and this response tells a client where to send them.
        </Text>
        <Box overflowX="auto" w="100%">
          <ParamTable>
            <Param name="experimentID" type="string">
              Your experiment ID, found on the experiment dashboard.
            </Param>
            <Param name="filename" type="string (optional)">
              The name this participant will submit under. Used only to name a
              recovered partial session, so an abandoned run is identifiable.
              A completed submission always uses the filename sent to{" "}
              <Code>/api/data/</Code>.
            </Param>
          </ParamTable>
        </Box>
        <Text maxW="70ch">
          The same checks as <Code>/api/data/</Code> run here, with the same
          error codes. The experiment must exist, not be finalized, be
          accepting data, and be under its session limit. Starting a session
          does <strong>not</strong> use up one of those sessions. The count is
          still taken when a submission completes. A <Code>503</Code> with{" "}
          <Code>SESSION_START_ERROR</Code> means incremental upload is
          unavailable, whether because the service is unreachable, because an
          experiment already has an unusually large number of sessions open at
          once, or because it has been switched off entirely. The experiment
          should submit at the end, as it would without streaming.
        </Text>
        <Box>
          <Text fontSize="sm" color="fg.muted" mb={2}>
            Example response
          </Text>
          <CodeBlock>
            {`{
  "sessionId": "8fKq2mXpR7vNwLzB4cTy1dHs",
  "databaseURL": "https://<project>-default-rtdb.firebaseio.com",
  "maxTrialBytes": 16384,
  "maxTrials": 1000,
  "flushIntervalMs": 10000,
  "flushEveryNTrials": 10,
  "maxDisconnects": 20
}`}
          </CodeBlock>
        </Box>
        <Text maxW="70ch">
          Trials are then written to{" "}
          <Code>staging/&lt;sessionId&gt;/trials/&lt;n&gt;</Code> in that
          database, each one a JSON string, numbered from zero and never
          rewritten. The session is write-only. Nothing can read it back, and
          DataPipe tolerates a missing number rather than treating it as an
          error. Send <Code>sessionId</Code> with the final{" "}
          <Code>/api/data/</Code> request to close it.
        </Text>
      </DocsSection>

      <DocsSection id="save-base64-data" title="Save base64-encoded data">
        <EndpointHeading method="POST" path="/api/base64/">
          Save base64-encoded data
        </EndpointHeading>
        <Text maxW="70ch">
          Save a binary file (audio, video, images) encoded as a base64
          string. DataPipe decodes the string and stores the resulting file
          alongside the experiment&apos;s other data.
        </Text>
        <Box overflowX="auto" w="100%">
          <ParamTable>
            <Param name="experimentID" type="string">
              Your experiment ID.
            </Param>
            <Param name="filename" type="string">
              Name for the decoded file (e.g., <Code>recording_01.webm</Code>).
              Must be unique.
            </Param>
            <Param name="data" type="string">
              The base64-encoded file contents.
            </Param>
          </ParamTable>
        </Box>
      </DocsSection>

      <DocsSection id="get-condition" title="Get condition assignment">
        <EndpointHeading method="POST" path="/api/condition/">
          Get condition assignment
        </EndpointHeading>
        <Text maxW="70ch">
          Get the next condition number for balanced assignment. Returns a
          value from 0 to n−1, cycling in order (0, 1, 2, ..., 0, 1, 2, ...).
        </Text>
        <Box overflowX="auto" w="100%">
          <ParamTable>
            <Param name="experimentID" type="string">
              Your experiment ID.
            </Param>
          </ParamTable>
        </Box>
        <Box>
          <Text fontSize="sm" color="fg.muted" mb={2}>
            Example response
          </Text>
          <CodeBlock>
            {`{
  "message": "Success",
  "condition": 2
}`}
          </CodeBlock>
        </Box>
      </DocsSection>

      <DocsSection id="responses" title="Responses">
        <Text maxW="70ch">
          All responses are JSON. On failure, the body carries an{" "}
          <Code>error</Code> code from the table below and a{" "}
          <Code>message</Code> describing the problem. When metadata is on,
          write responses also include a <Code>metadataMessage</Code> field
          reporting what happened to the metadata file. It never affects
          whether the data itself was stored.
        </Text>
        <Box overflowX="auto" w="100%">
          <Table.Root variant="outline">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader color="fg">Status</Table.ColumnHeader>
                <Table.ColumnHeader color="fg">Meaning</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Row>
                <Table.Cell>
                  <Code>201</Code>
                </Table.Cell>
                <Table.Cell>
                  Stored. The body is{" "}
                  <Code>{`{ "message": "Success" }`}</Code>. The condition
                  endpoint returns <Code>200</Code> with a{" "}
                  <Code>condition</Code> field instead.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>202</Code>
                </Table.Cell>
                <Table.Cell>
                  Accepted and queued. DataPipe has your data safely but
                  couldn&apos;t reach your storage provider yet, so it will
                  retry automatically. <Code>error</Code> is{" "}
                  <Code>null</Code>.{" "}
                  <strong>Treat this as success and do not resubmit.</strong>{" "}
                  Retrying would store the participant&apos;s data twice.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>400</Code>
                </Table.Cell>
                <Table.Cell>
                  Rejected. The data was not stored.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>500</Code>
                </Table.Cell>
                <Table.Cell>
                  Something failed on our side. See the individual codes below
                  for whether the data was stored.
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Box>
        <GuidanceLine href="/docs/data/failures" linkText="When an upload fails">
          What DataPipe does with a queued submission, and how to get it back.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="error-codes" title="Error codes">
        <Text fontSize="sm" color="fg.muted" maxW="70ch">
          <Code>FILE_EXISTS</Code>, <Code>UPLOAD_ERROR</Code>, and{" "}
          <Code>UPLOAD_EXCEPTION</Code> are returned for every storage
          provider. <Code>INVALID_OSF_TOKEN</Code> occurs only on experiments
          still collecting to OSF, which is why it still names it.
        </Text>
        <Text fontSize="sm" color="fg.muted" maxW="70ch">
          <Code>INVALID_OSF_TOKEN</Code>, <Code>INVALID_REFRESH_TOKEN</Code>,
          and <Code>PROVIDER_TOKEN_EXPIRED</Code> no longer reject a
          submission. If a connected account&apos;s credential has expired,
          been revoked, or gone invalid, DataPipe queues the submission for
          retry (<Code>202</Code>, <Code>error: null</Code>), the same as a
          provider outage, because reconnecting the account fixes it. They
          are listed below because a queued entry&apos;s{" "}
          <Code>failureReason</Code> and the failure-notification email still
          name them. <Code>PROVIDER_NOT_CONNECTED</Code> is the one credential
          code still rejected outright: with no connection at all, a retry has
          nothing to succeed against.
        </Text>
        <Box
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          p={4}
          maxW="70ch"
        >
          <Text fontSize="sm" fontWeight="semibold" mb={2}>
            Renamed in September 2026
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Three codes dropped their <Code>OSF_</Code> prefix:{" "}
            <Code>OSF_FILE_EXISTS</Code> → <Code>FILE_EXISTS</Code>,{" "}
            <Code>OSF_UPLOAD_ERROR</Code> → <Code>UPLOAD_ERROR</Code>, and{" "}
            <Code>OSF_UPLOAD_EXCEPTION</Code> → <Code>UPLOAD_EXCEPTION</Code>.
            They are returned on every provider, so the old names described
            nothing. If your experiment compares <Code>error</Code> against one
            of the old strings, that comparison no longer matches and the
            branch stops running — most often a retry that regenerates a
            filename after <Code>OSF_FILE_EXISTS</Code>. Match the new names,
            or both while you roll experiments over. The HTTP status codes are
            unchanged, so anything branching on those is unaffected. See{" "}
            <ProseLink href="/docs/whats-changed#error-codes">What&apos;s changed</ProseLink>{" "}
            for the rest of the September 2026 update.
          </Text>
        </Box>
        <Text fontSize="sm" color="fg.muted" maxW="70ch">
          The <Code>message</Code> text is human-readable only, and is
          reworded without notice. When writing code, match on the{" "}
          <Code>error</Code> code, not the message.
        </Text>
        <Box overflowX="auto" w="100%">
          <Table.Root variant="outline">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader color="fg">Error code</Table.ColumnHeader>
                <Table.ColumnHeader color="fg">Status</Table.ColumnHeader>
                <Table.ColumnHeader color="fg">Meaning</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <ErrorRow code="MISSING_PARAMETER" status={400}>
                One or more required fields are missing from the request body.
              </ErrorRow>
              <ErrorRow code="EXPERIMENT_NOT_FOUND" status={400}>
                No experiment matches the provided ID.
              </ErrorRow>
              <ErrorRow code="EXPERIMENT_DATA_NOT_FOUND" status={400}>
                The experiment exists, but DataPipe could not read its
                configuration.
              </ErrorRow>
              <ErrorRow code="USER_DATA_NOT_FOUND" status={400}>
                DataPipe could not read the account that owns the experiment.
              </ErrorRow>
              <ErrorRow code="INVALID_OWNER" status={400}>
                The experiment owner does not match a valid user account.
              </ErrorRow>
              <ErrorRow code="EXPERIMENT_FINALIZED" status={400}>
                The experiment has been finalized and no longer accepts
                submissions.
              </ErrorRow>
              <ErrorRow code="DATA_COLLECTION_NOT_ACTIVE" status={400}>
                Data collection is not enabled for this experiment.
              </ErrorRow>
              <ErrorRow code="BASE64DATA_COLLECTION_NOT_ACTIVE" status={400}>
                Base64 data collection is not enabled for this experiment.
              </ErrorRow>
              <ErrorRow code="CONDITION_ASSIGNMENT_NOT_ACTIVE" status={400}>
                Condition assignment is not enabled for this experiment.
              </ErrorRow>
              <ErrorRow code="SESSION_LIMIT_REACHED" status={400}>
                The experiment has reached its session limit. Raise the limit
                in the dashboard.
              </ErrorRow>
              <ErrorRow code="INVALID_DATA" status={400}>
                The data did not pass the validation rules set for this
                experiment.
              </ErrorRow>
              <ErrorRow code="INVALID_BASE64_DATA" status={400}>
                The data is not valid base64.
              </ErrorRow>
              <ErrorRow code="METADATA_ERROR" status={400}>
                DataPipe could not produce Psych-DS metadata from this
                submission, so it did not store the data. It keeps the
                submission and recovers it automatically in the background.
              </ErrorRow>
              <ErrorRow code="FILE_EXISTS" status={400}>
                A file with this name already exists in the experiment&apos;s
                storage. Filenames must be unique.
              </ErrorRow>
              <ErrorRow code="UPLOAD_ERROR" status={400}>
                The storage provider rejected the upload.
              </ErrorRow>
              <ErrorRow code="PROVIDER_NOT_CONNECTED" status={400}>
                The owner has not connected an account for this
                experiment&apos;s storage provider.
              </ErrorRow>
              <ErrorRow code="PROVIDER_TOKEN_EXPIRED" status="202 (queued)">
                The API token for the storage provider has expired. The
                submission is queued and retried automatically rather than
                rejected. The owner must still create a new token and
                reconnect it, since retrying alone cannot fix an expired
                static token, but no participant sees an error for it.
              </ErrorRow>
              <ErrorRow code="INVALID_OSF_TOKEN" status="202 (queued)">
                The OSF token for this account is invalid or expired. Queued
                and retried automatically; reconnecting the account is what
                lets a later retry succeed.
              </ErrorRow>
              <ErrorRow code="INVALID_REFRESH_TOKEN" status="202 (queued)">
                The owner&apos;s refresh token is no longer valid (OSF,
                Google Drive, or Zenodo). Queued and retried automatically;
                reconnecting the account is what lets a later retry succeed.
              </ErrorRow>
              <ErrorRow code="UNKNOWN_ERROR_GETTING_CONDITION" status={400}>
                An unexpected error occurred while assigning a condition.
              </ErrorRow>
              <ErrorRow code="TOKEN_RESOLUTION_ERROR" status={500}>
                DataPipe could not resolve the owner&apos;s storage credentials.
              </ErrorRow>
              <ErrorRow code="UPLOAD_EXCEPTION" status={500}>
                An unexpected error occurred while uploading to the storage
                provider.
              </ErrorRow>
              <ErrorRow code="DATA_PERSIST_ERROR" status={500}>
                DataPipe could not save the data, and a live participant may
                need to resubmit.
              </ErrorRow>
            </Table.Body>
          </Table.Root>
        </Box>
      </DocsSection>

      <DocsSection id="queue-status" title="Queue status">
        <EndpointHeading method="GET" path="/api/queuestatus">
          Queue status
        </EndpointHeading>
        <Text maxW="70ch">
          List the queued uploads DataPipe is holding for an experiment, or
          download them. This is the endpoint behind the queued files panel on
          the dashboard, and the scriptable way to recover data that
          hasn&apos;t reached your storage provider.
        </Text>
        <Text maxW="70ch">
          Unlike the three participant endpoints, this one is authenticated.
          Send a Firebase ID token for the account that owns the experiment
          as <Code>Authorization: Bearer &lt;token&gt;</Code>. Anything other
          than <Code>GET</Code> gets <Code>405</Code>.
        </Text>
        <Box overflowX="auto" w="100%">
          <ParamTable>
            <Param name="experimentID" type="query string">
              The experiment whose queue you want. Required.
            </Param>
            <Param name="download" type="query string (optional)">
              The <Code>id</Code> of a single queue entry. Responds with that
              file&apos;s contents as an attachment, decoded back to the
              original bytes for base64 submissions.
            </Param>
            <Param name="downloadAll" type="query string (optional)">
              Set to <Code>true</Code> to receive every waiting, in-flight,
              and failed file for the experiment as one ZIP.
            </Param>
          </ParamTable>
        </Box>
        <Text maxW="70ch">
          With no <Code>download</Code> or <Code>downloadAll</Code>, the
          response is <Code>200</Code> with an <Code>entries</Code> array and
          a <Code>count</Code>, newest first. Each entry carries{" "}
          <Code>id</Code>, <Code>filename</Code>, <Code>dataType</Code>,{" "}
          <Code>status</Code>, <Code>errorCode</Code>, <Code>retryCount</Code>,{" "}
          <Code>maxRetries</Code>, <Code>createdAt</Code>,{" "}
          <Code>lastAttemptAt</Code>, <Code>nextRetryAt</Code>, and{" "}
          <Code>failureReason</Code>. Only entries that are{" "}
          <Code>pending</Code>, <Code>processing</Code>, or <Code>failed</Code>{" "}
          are listed. A completed upload leaves the queue.
        </Text>
        <Box>
          <Text fontSize="sm" color="fg.muted" mb={2}>
            Example response
          </Text>
          <CodeBlock>
            {`{
  "entries": [
    {
      "id": "abc123_subject01.csv",
      "filename": "subject01.csv",
      "dataType": "data",
      "status": "pending",
      "errorCode": 503,
      "retryCount": 2,
      "maxRetries": 5,
      "createdAt": "2026-08-22T14:03:11.000Z",
      "lastAttemptAt": "2026-08-22T17:03:44.000Z",
      "nextRetryAt": "2026-08-22T21:03:44.000Z",
      "failureReason": "Provider error 503: Service Unavailable"
    }
  ],
  "count": 1
}`}
          </CodeBlock>
        </Box>
        <Box overflowX="auto" w="100%">
          <Table.Root variant="outline">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader color="fg">Status</Table.ColumnHeader>
                <Table.ColumnHeader color="fg">Meaning</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Row>
                <Table.Cell>
                  <Code>400</Code>
                </Table.Cell>
                <Table.Cell>
                  No <Code>experimentID</Code> query parameter.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>401</Code>
                </Table.Cell>
                <Table.Cell>
                  No <Code>Authorization</Code> header, or the token could not
                  be verified.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>403</Code>
                </Table.Cell>
                <Table.Cell>
                  You do not own that experiment. A nonexistent experiment gets
                  the same answer, so this endpoint never reveals which
                  experiment IDs exist.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>404</Code>
                </Table.Cell>
                <Table.Cell>
                  The requested queue entry does not belong to that experiment,
                  or <Code>downloadAll</Code> found nothing queued.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>405</Code>
                </Table.Cell>
                <Table.Cell>The request was not a GET.</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>500</Code>
                </Table.Cell>
                <Table.Cell>
                  DataPipe could not read a queued upload. Nothing has been
                  deleted. Try again, or fetch the files one at a time.
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Box>
      </DocsSection>

      <DocsSection id="finalize" title="Finalize">
        <EndpointHeading method="POST" path="/api/finalize">
          Finalize
        </EndpointHeading>
        <Text maxW="70ch">
          Start finalizing an experiment: merge everything in its storage into
          one archive and permanently stop accepting submissions. This is the
          endpoint behind the Finalize control on the dashboard.
        </Text>
        <Text maxW="70ch">
          Authenticated the same way as queue status:{" "}
          <Code>Authorization: Bearer &lt;token&gt;</Code> for the owning
          account. Anything other than <Code>POST</Code> gets{" "}
          <Code>405</Code>.
        </Text>
        <Box overflowX="auto" w="100%">
          <ParamTable>
            <Param name="experimentID" type="string">
              The experiment to finalize. Required.
            </Param>
          </ParamTable>
        </Box>
        <Text maxW="70ch">
          <strong>The response doesn&apos;t tell you the outcome.</strong>{" "}
          Merging a whole study takes longer than the 60-second request
          ceiling, so a successful call returns <Code>202</Code> with{" "}
          <Code>{`{ "status": "queued" }`}</Code> and the work runs in the
          background. Watch the experiment&apos;s dashboard, which reports{" "}
          <em>queued</em>, then <em>running</em>, then the result. Calling
          again while a pass is in flight returns <Code>202</Code> with the
          current status rather than starting a second one.
        </Text>
        <Box overflowX="auto" w="100%">
          <Table.Root variant="outline">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader color="fg">Status</Table.ColumnHeader>
                <Table.ColumnHeader color="fg">Meaning</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Row>
                <Table.Cell>
                  <Code>202</Code>
                </Table.Cell>
                <Table.Cell>
                  Accepted. Body is <Code>{`{ "status": "queued" }`}</Code>, or{" "}
                  <Code>queued</Code>/<Code>running</Code> if a pass was already
                  under way.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>200</Code>
                </Table.Cell>
                <Table.Cell>
                  <Code>{`{ "status": "already-finalized" }`}</Code>. Nothing to
                  do. Finalizing is permanent.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>400</Code>
                </Table.Cell>
                <Table.Cell>
                  No <Code>experimentID</Code>, or the experiment predates the
                  per-experiment storage DataPipe now creates and carries{" "}
                  <Code>{`{ "status": "not-eligible" }`}</Code> with a{" "}
                  <Code>detail</Code>.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>401</Code>
                </Table.Cell>
                <Table.Cell>Missing or unverifiable bearer token.</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>403</Code>
                </Table.Cell>
                <Table.Cell>
                  You do not own that experiment, or it does not exist.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>405</Code>
                </Table.Cell>
                <Table.Cell>The request was not a POST.</Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>500</Code>
                </Table.Cell>
                <Table.Cell>
                  DataPipe could not schedule the background job. Nothing has
                  been merged or deleted.
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Box>

        <Heading as="h3" fontSize="md" fontWeight="600" color="fg" mt={2}>
          Statuses the dashboard reports
        </Heading>
        <Text maxW="70ch">
          The outcome lands on the experiment record. These are all the
          possible statuses:
        </Text>
        <Box overflowX="auto" w="100%">
          <Table.Root variant="outline">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader color="fg">Status</Table.ColumnHeader>
                <Table.ColumnHeader color="fg">Meaning</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <ErrorRow code="queued" status="in flight">
                The background job has been scheduled.
              </ErrorRow>
              <ErrorRow code="running" status="in flight">
                The merge is under way.
              </ErrorRow>
              <ErrorRow code="finalized" status="done">
                One archive now holds the whole dataset and the experiment
                accepts no further submissions.
              </ErrorRow>
              <ErrorRow code="already-finalized" status="done">
                It had already been finalized.
              </ErrorRow>
              <ErrorRow code="not-eligible" status="refused">
                This storage provider has no file-count ceiling to work
                around. Today that means anything other than Zenodo.
              </ErrorRow>
              <ErrorRow code="queued-uploads-pending" status="refused">
                Uploads are still waiting to be stored, and they belong inside
                the archive. Let the upload queue drain and try again.
              </ErrorRow>
              <ErrorRow code="nothing-to-archive" status="refused">
                The experiment has never received any data.
              </ErrorRow>
              <ErrorRow code="leased-elsewhere" status="refused">
                Another finalizing pass or archive merge is already running for
                this experiment. Try again shortly.
              </ErrorRow>
              <ErrorRow code="archive-too-large" status="refused">
                The merged archive would exceed the provider&apos;s per-file
                limit. Nothing was uploaded or deleted.
              </ErrorRow>
              <ErrorRow code="failed" status="error">
                Something went wrong during the pass. DataPipe deletes files
                only after verifying the archive that replaces them.
              </ErrorRow>
            </Table.Body>
          </Table.Root>
        </Box>
        <GuidanceLine href="/docs/data/finalizing" linkText="Finishing a study">
          What finalizing does to your files, and which providers support it.
        </GuidanceLine>
      </DocsSection>
    </>
  );
}

ApiReferencePage.getLayout = function getLayout(page) {
  return <DocsLayout>{page}</DocsLayout>;
};
