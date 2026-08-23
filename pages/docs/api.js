import { Text, Table, Code, Box, Heading } from "@chakra-ui/react";
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

export default function ApiReferencePage() {
  return (
    <>
      <PageHeader
        title="API reference"
        purpose="Every endpoint your experiment can call, what it returns, and the limits every request runs under."
      />

      <Text maxW="70ch">
        All endpoints accept JSON request bodies with{" "}
        <Code>Content-Type: application/json</Code>. You will need an experiment
        ID, which you get when you create an experiment on DataPipe. Code
        examples for jsPsych and JavaScript are available on each
        experiment&apos;s dashboard.
      </Text>
      <Text maxW="70ch" mt={4}>
        The API is the same whichever storage provider an experiment uses.
        DataPipe routes each submission to that experiment&apos;s own
        destination — a Google Drive folder, a Dataverse dataset, or a Zenodo
        deposition — so your experiment code never names a provider.
      </Text>

      <DocsSection id="limits" title="Limits">
        <Text maxW="70ch">
          Three limits apply to every request, and none of them is configurable
          per experiment.
        </Text>
        <Box as="ul" pl={5} listStyleType="disc" maxW="70ch">
          <Box as="li" mb={2}>
            <strong>32 MB per request.</strong> Enforced by the server
            infrastructure and not raisable. A typical jsPsych dataset is 50 KB
            to 5 MB, so this bites mainly on base64 media. Gzipped request
            bodies are decompressed transparently, which effectively raises the
            ceiling for text data.
          </Box>
          <Box as="li" mb={2}>
            <strong>60 seconds per request.</strong> Every <Code>/api/*</Code>{" "}
            path runs behind a hosting layer with a hard 60-second ceiling. It
            is why <Code>/api/finalize</Code> returns immediately and does its
            work in the background rather than answering when the job is done.
          </Box>
          <Box as="li" mb={2}>
            <strong>JSON bodies only.</strong> Send{" "}
            <Code>Content-Type: application/json</Code>. The three participant
            endpoints do not check the HTTP method, so a request sent with the
            wrong verb arrives with an empty body and comes back as{" "}
            <Code>MISSING_PARAMETER</Code> rather than{" "}
            <Code>405</Code>. The two authenticated endpoints below do check,
            and answer <Code>405</Code>.
          </Box>
        </Box>
        <GuidanceLine
          href="/docs/experiments/sending-data#request-size-limits"
          linkText="Request size limits"
        >
          Compressing a request body yourself, and what the size limit means in
          practice.
        </GuidanceLine>
      </DocsSection>

      <DocsSection id="save-text-data" title="Save text data">
        <EndpointHeading method="POST" path="/api/data/">
          Save text data
        </EndpointHeading>
        <Text maxW="70ch">
          Save a text file (CSV, JSON, etc.) to your experiment&apos;s storage.
          If you have validation rules configured, DataPipe checks the data
          before sending it on.
        </Text>
        <Box overflowX="auto" w="100%">
          <ParamTable>
            <Param name="experimentID" type="string">
              Your experiment ID, found on the experiment dashboard.
            </Param>
            <Param name="filename" type="string">
              Name for the stored file (e.g., <Code>subject01.csv</Code>). Must
              be unique — the request will fail if a file with this name already
              exists.
            </Param>
            <Param name="data" type="string">
              The file contents as a string.
            </Param>
            <Param name="metadataOptions" type="object (optional)">
              Extra Psych-DS metadata to merge into this experiment&apos;s
              dataset description. Ignored unless metadata is switched on for
              the experiment.
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

      <DocsSection id="save-base64-data" title="Save base64-encoded data">
        <EndpointHeading method="POST" path="/api/base64/">
          Save base64-encoded data
        </EndpointHeading>
        <Text maxW="70ch">
          Save a binary file (audio, video, images) encoded as a base64 string.
          DataPipe decodes the string and stores the resulting file alongside the
          experiment&apos;s other data.
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
          Get the next condition number for balanced assignment. Returns a value
          from 0 to n−1, cycling sequentially (0, 1, 2, ..., 0, 1, 2, ...).
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
          reporting what happened to the metadata file; it never affects whether
          the data itself was stored.
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
                  Accepted and queued. DataPipe has your data safely but could
                  not reach your storage provider yet, so it will retry
                  automatically. <Code>error</Code> is <Code>null</Code>.{" "}
                  <strong>Treat this as success and do not resubmit</strong> —
                  retrying would store the participant&apos;s data twice.
                </Table.Cell>
              </Table.Row>
              <Table.Row>
                <Table.Cell>
                  <Code>400</Code>
                </Table.Cell>
                <Table.Cell>
                  The request was rejected and the data was not stored.
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
          Codes beginning <Code>OSF_</Code> are historical names kept for
          backward compatibility. <Code>OSF_FILE_EXISTS</Code>,{" "}
          <Code>OSF_UPLOAD_ERROR</Code> and <Code>OSF_UPLOAD_EXCEPTION</Code>{" "}
          are returned for every storage provider, not only OSF.{" "}
          <Code>INVALID_OSF_TOKEN</Code> and <Code>INVALID_REFRESH_TOKEN</Code>{" "}
          occur only on experiments still collecting to OSF.
        </Text>
        <Text fontSize="sm" color="fg.muted" maxW="70ch">
          The same applies to the <Code>message</Code> text: several messages
          still name OSF whatever provider an experiment actually uses — a
          queued upload reports &ldquo;Data received. OSF upload will be retried
          automatically&rdquo; on Google Drive, Dataverse, and Zenodo alike. Read
          &ldquo;OSF&rdquo; in a message as &ldquo;your storage
          provider&rdquo;, and match on the <Code>error</Code> code rather than
          the message when you are writing code.
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
                The experiment exists but its configuration could not be read.
              </ErrorRow>
              <ErrorRow code="USER_DATA_NOT_FOUND" status={400}>
                The account that owns the experiment could not be read.
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
                The experiment has reached its session limit. Raise the limit in
                the dashboard.
              </ErrorRow>
              <ErrorRow code="INVALID_DATA" status={400}>
                The data did not pass the validation rules configured for this
                experiment.
              </ErrorRow>
              <ErrorRow code="INVALID_BASE64_DATA" status={400}>
                The data is not valid base64.
              </ErrorRow>
              <ErrorRow code="METADATA_ERROR" status={400}>
                Psych-DS metadata could not be produced from this submission, so
                the data was not stored. The submission is kept and recovered
                automatically in the background.
              </ErrorRow>
              <ErrorRow code="OSF_FILE_EXISTS" status={400}>
                A file with this name already exists in the experiment&apos;s
                storage. Filenames must be unique.
              </ErrorRow>
              <ErrorRow code="OSF_UPLOAD_ERROR" status={400}>
                The storage provider rejected the upload.
              </ErrorRow>
              <ErrorRow code="PROVIDER_NOT_CONNECTED" status={400}>
                The owner has not connected an account for this
                experiment&apos;s storage provider.
              </ErrorRow>
              <ErrorRow code="PROVIDER_TOKEN_EXPIRED" status={400}>
                The API token for the storage provider has expired. The owner
                must create a new one and reconnect it.
              </ErrorRow>
              <ErrorRow code="INVALID_OSF_TOKEN" status={400}>
                The OSF token for this account is invalid or expired.
              </ErrorRow>
              <ErrorRow code="INVALID_REFRESH_TOKEN" status={400}>
                The owner&apos;s OSF refresh token is no longer valid.
              </ErrorRow>
              <ErrorRow code="UNKNOWN_ERROR_GETTING_CONDITION" status={400}>
                An unexpected error occurred while assigning a condition.
              </ErrorRow>
              <ErrorRow code="TOKEN_RESOLUTION_ERROR" status={500}>
                DataPipe could not resolve the owner&apos;s storage credentials.
              </ErrorRow>
              <ErrorRow code="OSF_UPLOAD_EXCEPTION" status={500}>
                An unexpected error occurred while uploading to the storage
                provider.
              </ErrorRow>
              <ErrorRow code="DATA_PERSIST_ERROR" status={500}>
                DataPipe could not save the data. It was not stored, and a live
                participant may need to resubmit.
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
          the dashboard, and the scriptable way to recover data that has not
          reached your storage provider.
        </Text>
        <Text maxW="70ch">
          Unlike the three participant endpoints, this one is authenticated:
          send a Firebase ID token for the account that owns the experiment as{" "}
          <Code>Authorization: Bearer &lt;token&gt;</Code>. Anything other than{" "}
          <Code>GET</Code> is answered <Code>405</Code>.
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
              Set to <Code>true</Code> to receive every waiting, in-flight and
              failed file for the experiment as one ZIP.
            </Param>
          </ParamTable>
        </Box>
        <Text maxW="70ch">
          With no <Code>download</Code> or <Code>downloadAll</Code>, the
          response is <Code>200</Code> with an <Code>entries</Code> array and a{" "}
          <Code>count</Code>, newest first. Each entry carries{" "}
          <Code>id</Code>, <Code>filename</Code>, <Code>dataType</Code>,{" "}
          <Code>status</Code>, <Code>errorCode</Code>, <Code>retryCount</Code>,{" "}
          <Code>maxRetries</Code>, <Code>createdAt</Code>,{" "}
          <Code>lastAttemptAt</Code>, <Code>nextRetryAt</Code> and{" "}
          <Code>failureReason</Code>. Only entries that are{" "}
          <Code>pending</Code>, <Code>processing</Code> or <Code>failed</Code>{" "}
          are listed — a completed upload leaves the queue.
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
                  A queued upload could not be read. Nothing has been deleted —
                  try again, or fetch the files individually.
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
          Authenticated the same way as queue status —{" "}
          <Code>Authorization: Bearer &lt;token&gt;</Code> for the owning
          account. Anything other than <Code>POST</Code> is answered{" "}
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
          <strong>The response does not tell you the outcome.</strong> Merging a
          whole study takes longer than the 60-second request ceiling, so a
          successful call returns <Code>202</Code> with{" "}
          <Code>{`{ "status": "queued" }`}</Code> and the work runs in the
          background. Watch the experiment&apos;s dashboard, which reports{" "}
          <em>queued</em>, then <em>running</em>, then the result. Calling again
          while a pass is in flight returns <Code>202</Code> with the current
          status rather than starting a second one.
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
                  do; finalizing is permanent.
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
                  The background job could not be scheduled. Nothing has been
                  merged or deleted.
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Box>

        <Heading as="h3" fontSize="md" fontWeight="600" color="fg" mt={2}>
          Statuses the dashboard reports
        </Heading>
        <Text maxW="70ch">
          The outcome lands on the experiment record. The full vocabulary is:
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
                This storage provider has no file-count ceiling to relieve —
                today that means anything other than Zenodo.
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
                Something went wrong during the pass. Files are only ever
                deleted after the archive that replaces them is verified.
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
