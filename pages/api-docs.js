import {
  Stack,
  Heading,
  Text,
  Link,
  Table,
  Badge,
  Code,
  Box,
  VStack,
} from "@chakra-ui/react";
import CodeBlock from "../components/CodeBlock";

const BASE_URL = "https://pipe.jspsych.org";

function EndpointHeading({ method, path, children }) {
  return (
    <Stack gap={3}>
      <Heading as="h2" size="md">
        {children}
      </Heading>
      <Text>
        <Badge colorPalette="green" mr={2}>{method}</Badge>
        <Code>{BASE_URL}{path}</Code>
      </Text>
    </Stack>
  );
}

function ParamTable({ children }) {
  return (
    <Table.Root variant="outline">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader color="fg">Field</Table.ColumnHeader>
          <Table.ColumnHeader color="fg">Type</Table.ColumnHeader>
          <Table.ColumnHeader color="fg">Description</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {children}
      </Table.Body>
    </Table.Root>
  );
}

function Param({ name, type, children }) {
  return (
    <Table.Row>
      <Table.Cell><Code>{name}</Code></Table.Cell>
      <Table.Cell><Text fontSize="sm" color="fg.muted">{type}</Text></Table.Cell>
      <Table.Cell>{children}</Table.Cell>
    </Table.Row>
  );
}

function ErrorRow({ code, status, children }) {
  return (
    <Table.Row>
      <Table.Cell><Code>{code}</Code></Table.Cell>
      <Table.Cell><Text fontSize="sm" color="fg.muted">{status}</Text></Table.Cell>
      <Table.Cell>{children}</Table.Cell>
    </Table.Row>
  );
}

export default function ApiDocs() {
  return (
    // 960 -> the committed 1100px measure (DESIGN.md §4), which this page
    // wants anyway: it carries three reference tables, one of them 22 rows.
    // `py={4}` removed -- _app.js owns the navbar and footer gaps now.
    <Stack w="100%" maxW="1100px" gap={12}>

      <Stack gap={3}>
        <Heading as="h1" size="xl">
          API Reference
        </Heading>
        <Text>
          All endpoints accept JSON request bodies with{" "}
          <Code>Content-Type: application/json</Code>. You will need
          an experiment ID, which you get when you create an experiment
          on DataPipe. Code examples for jsPsych and JavaScript are
          available on each experiment&apos;s dashboard.
        </Text>
        <Text>
          The API is the same whichever storage provider an experiment uses.
          DataPipe routes each submission to that experiment&apos;s own
          destination — a Google Drive folder, a Dataverse dataset, or a
          Zenodo deposition — so your experiment code never names a provider.
        </Text>
      </Stack>

      {/* Save text data */}
      <Stack gap={4}>
        <EndpointHeading method="POST" path="/api/data/">
          Save text data
        </EndpointHeading>
        <Text>
          Save a text file (CSV, JSON, etc.) to your experiment&apos;s
          storage. If you have validation rules configured, DataPipe checks
          the data before sending it on.
        </Text>
        <ParamTable>
          <Param name="experimentID" type="string">
            Your experiment ID, found on the experiment dashboard.
          </Param>
          <Param name="filename" type="string">
            Name for the stored file (e.g., <Code>subject01.csv</Code>).
            Must be unique — the request will fail if a file with this name
            already exists.
          </Param>
          <Param name="data" type="string">
            The file contents as a string.
          </Param>
        </ParamTable>
        <Box>
          <Text fontSize="sm" color="fg.muted" mb={2}>Example request body</Text>
          <CodeBlock>
            {`{
  "experimentID": "abc123",
  "filename": "subject01.csv",
  "data": "rt,response\\n204,1\\n389,0"
}`}
          </CodeBlock>
        </Box>
      </Stack>

      {/* Save base64 data */}
      <Stack gap={4}>
        <EndpointHeading method="POST" path="/api/base64/">
          Save base64-encoded data
        </EndpointHeading>
        <Text>
          Save a binary file (audio, video, images) encoded as a base64
          string. DataPipe decodes the string and stores the resulting
          file alongside the experiment&apos;s other data.
        </Text>
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
      </Stack>

      {/* Condition assignment */}
      <Stack gap={4}>
        <EndpointHeading method="POST" path="/api/condition/">
          Get condition assignment
        </EndpointHeading>
        <Text>
          Get the next condition number for balanced assignment. Returns
          a value from 0 to n−1, cycling sequentially (0, 1, 2, ..., 0,
          1, 2, ...).
        </Text>
        <ParamTable>
          <Param name="experimentID" type="string">
            Your experiment ID.
          </Param>
        </ParamTable>
        <Box>
          <Text fontSize="sm" color="fg.muted" mb={2}>Example response</Text>
          <CodeBlock>
            {`{
  "condition": 2
}`}
          </CodeBlock>
        </Box>
      </Stack>

      {/* Responses */}
      <Stack gap={4}>
        <Heading as="h2" size="md">
          Responses
        </Heading>
        <Text>
          All responses are JSON. On failure, the body carries an{" "}
          <Code>error</Code> code from the table below and a{" "}
          <Code>message</Code> describing the problem. When metadata
          production is enabled, write responses also include a{" "}
          <Code>metadataMessage</Code> field reporting what happened to the
          metadata file; it never affects whether the data itself was stored.
        </Text>
        <Table.Root variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader color="fg">Status</Table.ColumnHeader>
              <Table.ColumnHeader color="fg">Meaning</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row>
              <Table.Cell><Code>201</Code></Table.Cell>
              <Table.Cell>
                Stored. The body is{" "}
                <Code>{`{ "message": "Success" }`}</Code>. The condition
                endpoint returns <Code>200</Code> with a{" "}
                <Code>condition</Code> field instead.
              </Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell><Code>202</Code></Table.Cell>
              <Table.Cell>
                Accepted and queued. DataPipe has your data safely but could
                not reach your storage provider yet, so it will retry
                automatically. <Code>error</Code> is <Code>null</Code>.{" "}
                <strong>Treat this as success and do not resubmit</strong> —
                retrying would store the participant&apos;s data twice.
              </Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell><Code>400</Code></Table.Cell>
              <Table.Cell>
                The request was rejected and the data was not stored.
              </Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell><Code>500</Code></Table.Cell>
              <Table.Cell>
                Something failed on our side. See the individual codes below
                for whether the data was stored.
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table.Root>

        <Heading as="h3" size="sm" mt={4}>
          Error codes
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          Codes beginning <Code>OSF_</Code> are historical names kept for
          backward compatibility. <Code>OSF_FILE_EXISTS</Code>,{" "}
          <Code>OSF_UPLOAD_ERROR</Code> and <Code>OSF_UPLOAD_EXCEPTION</Code>{" "}
          are returned for every storage provider, not only OSF.{" "}
          <Code>INVALID_OSF_TOKEN</Code> and <Code>INVALID_REFRESH_TOKEN</Code>{" "}
          occur only on experiments still collecting to OSF.
        </Text>
        <Table.Root variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader color="fg">Error code</Table.ColumnHeader>
              <Table.ColumnHeader color="fg">Status</Table.ColumnHeader>
              <Table.ColumnHeader color="fg">Meaning</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <ErrorRow code="MISSING_PARAMETER" status={400}>One or more required fields are missing from the request body.</ErrorRow>
            <ErrorRow code="EXPERIMENT_NOT_FOUND" status={400}>No experiment matches the provided ID.</ErrorRow>
            <ErrorRow code="EXPERIMENT_DATA_NOT_FOUND" status={400}>The experiment exists but its configuration could not be read.</ErrorRow>
            <ErrorRow code="USER_DATA_NOT_FOUND" status={400}>The account that owns the experiment could not be read.</ErrorRow>
            <ErrorRow code="INVALID_OWNER" status={400}>The experiment owner does not match a valid user account.</ErrorRow>
            <ErrorRow code="EXPERIMENT_FINALIZED" status={400}>The experiment has been finalized and no longer accepts submissions.</ErrorRow>
            <ErrorRow code="DATA_COLLECTION_NOT_ACTIVE" status={400}>Data collection is not enabled for this experiment.</ErrorRow>
            <ErrorRow code="BASE64DATA_COLLECTION_NOT_ACTIVE" status={400}>Base64 data collection is not enabled for this experiment.</ErrorRow>
            <ErrorRow code="CONDITION_ASSIGNMENT_NOT_ACTIVE" status={400}>Condition assignment is not enabled for this experiment.</ErrorRow>
            <ErrorRow code="SESSION_LIMIT_REACHED" status={400}>The experiment has reached its session limit. Raise the limit in the dashboard.</ErrorRow>
            <ErrorRow code="INVALID_DATA" status={400}>The data did not pass the validation rules configured for this experiment.</ErrorRow>
            <ErrorRow code="INVALID_BASE64_DATA" status={400}>The data is not valid base64.</ErrorRow>
            <ErrorRow code="OSF_FILE_EXISTS" status={400}>A file with this name already exists in the experiment&apos;s storage. Filenames must be unique.</ErrorRow>
            <ErrorRow code="OSF_UPLOAD_ERROR" status={400}>The storage provider rejected the upload.</ErrorRow>
            <ErrorRow code="PROVIDER_NOT_CONNECTED" status={400}>The owner has not connected an account for this experiment&apos;s storage provider.</ErrorRow>
            <ErrorRow code="PROVIDER_TOKEN_EXPIRED" status={400}>The API token for the storage provider has expired. The owner must create a new one and reconnect it.</ErrorRow>
            <ErrorRow code="INVALID_OSF_TOKEN" status={400}>The OSF token for this account is invalid or expired.</ErrorRow>
            <ErrorRow code="INVALID_REFRESH_TOKEN" status={400}>The owner&apos;s OSF refresh token is no longer valid.</ErrorRow>
            <ErrorRow code="UNKNOWN_ERROR_GETTING_CONDITION" status={400}>An unexpected error occurred while assigning a condition.</ErrorRow>
            <ErrorRow code="TOKEN_RESOLUTION_ERROR" status={500}>DataPipe could not resolve the owner&apos;s storage credentials.</ErrorRow>
            <ErrorRow code="OSF_UPLOAD_EXCEPTION" status={500}>An unexpected error occurred while uploading to the storage provider.</ErrorRow>
            <ErrorRow code="DATA_PERSIST_ERROR" status={500}>DataPipe could not save the data. It was not stored, and a live participant may need to resubmit.</ErrorRow>
          </Table.Body>
        </Table.Root>
      </Stack>
    </Stack>
  );
}
