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
          <Table.ColumnHeader color="white">Field</Table.ColumnHeader>
          <Table.ColumnHeader color="white">Type</Table.ColumnHeader>
          <Table.ColumnHeader color="white">Description</Table.ColumnHeader>
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
      <Table.Cell><Text fontSize="sm" color="gray.400">{type}</Text></Table.Cell>
      <Table.Cell>{children}</Table.Cell>
    </Table.Row>
  );
}

export default function ApiDocs() {
  return (
    <Stack w={["95%", 960]} gap={12} py={4}>

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
      </Stack>

      {/* Save text data */}
      <Stack gap={4}>
        <EndpointHeading method="POST" path="/api/data/">
          Save text data
        </EndpointHeading>
        <Text>
          Save a text file (CSV, JSON, etc.) to your OSF project. If you
          have validation rules configured, the data will be checked before
          it is sent to the OSF.
        </Text>
        <ParamTable>
          <Param name="experimentID" type="string">
            Your experiment ID, found on the experiment dashboard.
          </Param>
          <Param name="filename" type="string">
            Name for the file on OSF (e.g., <Code>subject01.csv</Code>).
            Must be unique — the request will fail if a file with this name
            already exists.
          </Param>
          <Param name="data" type="string">
            The file contents as a string.
          </Param>
        </ParamTable>
        <Box>
          <Text fontSize="sm" color="gray.400" mb={2}>Example request body</Text>
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
          file in your OSF project.
        </Text>
        <ParamTable>
          <Param name="experimentID" type="string">
            Your experiment ID.
          </Param>
          <Param name="filename" type="string">
            Name for the decoded file on OSF (e.g., <Code>recording_01.webm</Code>).
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
          <Text fontSize="sm" color="gray.400" mb={2}>Example response</Text>
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
          All responses are JSON. A successful request returns{" "}
          <Code>{`{ "message": "Success" }`}</Code>. The condition
          endpoint also includes a <Code>condition</Code> field.
          On failure, the response contains an <Code>error</Code> code
          and a <Code>message</Code> describing the problem.
        </Text>
        <Table.Root variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader color="white">Error code</Table.ColumnHeader>
              <Table.ColumnHeader color="white">Meaning</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row><Table.Cell><Code>MISSING_PARAMETER</Code></Table.Cell><Table.Cell>One or more required fields are missing from the request body.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>EXPERIMENT_NOT_FOUND</Code></Table.Cell><Table.Cell>No experiment matches the provided ID.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>DATA_COLLECTION_NOT_ACTIVE</Code></Table.Cell><Table.Cell>Data collection is not enabled for this experiment.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>BASE64DATA_COLLECTION_NOT_ACTIVE</Code></Table.Cell><Table.Cell>Base64 data collection is not enabled for this experiment.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>CONDITION_ASSIGNMENT_NOT_ACTIVE</Code></Table.Cell><Table.Cell>Condition assignment is not enabled for this experiment.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>SESSION_LIMIT_REACHED</Code></Table.Cell><Table.Cell>The experiment has reached its session limit. Increase the limit in the dashboard.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>INVALID_DATA</Code></Table.Cell><Table.Cell>The data did not pass the validation rules configured for this experiment.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>INVALID_BASE64_DATA</Code></Table.Cell><Table.Cell>The data is not valid base64.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>OSF_FILE_EXISTS</Code></Table.Cell><Table.Cell>A file with this name already exists in the OSF project. Filenames must be unique.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>OSF_UPLOAD_ERROR</Code></Table.Cell><Table.Cell>DataPipe could not upload the file to OSF. Try again later.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>INVALID_OWNER</Code></Table.Cell><Table.Cell>The experiment owner does not match a valid user account.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>INVALID_OSF_TOKEN</Code></Table.Cell><Table.Cell>The OSF token for this account is invalid or expired. Reconnect your OSF account in settings.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>INVALID_METADATA_ERROR</Code></Table.Cell><Table.Cell>The metadata generated from the data is invalid.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>OSF_METADATA_UPLOAD_ERROR</Code></Table.Cell><Table.Cell>DataPipe could not upload the metadata file to OSF.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>METADATA_ERROR</Code></Table.Cell><Table.Cell>An error occurred while processing metadata.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell><Code>UNKNOWN_ERROR_GETTING_CONDITION</Code></Table.Cell><Table.Cell>An unexpected error occurred while assigning a condition.</Table.Cell></Table.Row>
          </Table.Body>
        </Table.Root>
      </Stack>
    </Stack>
  );
}
