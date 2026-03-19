import {
  Stack,
  Heading,
  Text,
  Button,
  Link,
  Table,
  Badge,
  Code
} from "@chakra-ui/react";

export default function ApiDocs() {
  return (
    <Stack w={["95%", 960]} gap={10}>

      <Stack gap={2}>
        <Heading as="h1" size="xl">
          API Documentation
        </Heading>
        <Text>
          Using the API requires setting up an experiment to obtain an experiment ID.
          Code examples for using JavaScript and jsPsych are available in the experiment dashboard.
        </Text>
      </Stack>

      <Stack gap={2}>
        <Heading as="h2" size="md">
          Save text-based data
        </Heading>
        <Text>
          <Badge colorPalette="green">POST</Badge> /api/data
        </Text>
        <Text>
          Save a text-based data file to the OSF. The data can be optionally validated by setting up validation
          rules in the experiment configuration.
        </Text>
        <Table.Root variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader color="white">Parameter</Table.ColumnHeader>
              <Table.ColumnHeader color="white">Description</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row>
              <Table.Cell>experimentID</Table.Cell>
              <Table.Cell>The ID of the experiment to save data for. This ID is provided when an experiment is created on DataPipe.</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>data</Table.Cell>
              <Table.Cell>The text-based data to save, sent as a string.</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>filename</Table.Cell>
              <Table.Cell>The name of the file to create. This filename must be unique. If the file already exists the request will fail.</Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table.Root>
      </Stack>
      <Stack gap={2}>
        <Heading as="h2" size="md">
          Save base64-encoded data
        </Heading>
        <Text>
          <Badge colorPalette="green">POST</Badge> /api/base64
        </Text>
        <Text>
          Save a base64-encoded file to the OSF. The file will be decoded before being posted to the OSF.
        </Text>
        <Table.Root variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader color="white">Parameter</Table.ColumnHeader>
              <Table.ColumnHeader color="white">Description</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row>
              <Table.Cell>experimentID</Table.Cell>
              <Table.Cell>The ID of the experiment to save data for. This ID is provided when an experiment is created on DataPipe.</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>data</Table.Cell>
              <Table.Cell>The base64-encoded data to save, sent as a string.</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>filename</Table.Cell>
              <Table.Cell>The name of the file to create. This filename must be unique. If the file already exists the request will fail.</Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table.Root>
      </Stack>
      <Stack gap={2}>
        <Heading as="h2" size="md">
          Get condition assignment
        </Heading>
        <Text>
          <Badge colorPalette="green">POST</Badge> /api/condition
        </Text>
        <Text>
          Get the next condition assignment in an experiment. The condition is a numerical value from 0 to n-1, where n
          is the number of conditions in the experiment. Condition assignment is sequential, so the first request will
          return 0, the second request will return 1, and so on.
        </Text>
        <Table.Root variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader color="white">Parameter</Table.ColumnHeader>
              <Table.ColumnHeader color="white">Description</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row>
              <Table.Cell>experimentID</Table.Cell>
              <Table.Cell>The ID of the experiment. This ID is provided when an experiment is created on DataPipe.</Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table.Root>
        <Text>
          On a successful request, the JSON response will contain a <Code>condition</Code> parameter with the condition assignment.
        </Text>
      </Stack>
      <Stack gap={2}>
        <Heading as="h2" size="md">
          API Responses
        </Heading>
        <Text>Responses from the API are JSON. On a successful request the response will contain a <Code>message</Code>{' '}
          parameter will the value <Code>Success</Code>. When an error occurs, the responses will contain one of the <Code>error</Code>{' '}
          and <Code>message</Code> parameter sets shown below.</Text>
        <Table.Root variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader color="white">Error</Table.ColumnHeader>
              <Table.ColumnHeader color="white">Message</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row><Table.Cell>MISSING_PARAMETER</Table.Cell><Table.Cell>One or more required parameters are missing.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>DATA_COLLECTION_NOT_ACTIVE</Table.Cell><Table.Cell>Data collection is not active for this experiment</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>BASE64DATA_COLLECTION_NOT_ACTIVE</Table.Cell><Table.Cell>Base64 data collection is not active for this experiment</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>CONDITION_ASSIGNMENT_NOT_ACTIVE</Table.Cell><Table.Cell>Condition assignment is not active for this experiment</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>EXPERIMENT_NOT_FOUND</Table.Cell><Table.Cell>The experiment ID does not match an experiment</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>INVALID_OWNER</Table.Cell><Table.Cell>The owner ID of this experiment does not match a valid user</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>INVALID_OSF_TOKEN</Table.Cell><Table.Cell>The OSF token for this experiment is not valid</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>INVALID_BASE64_DATA</Table.Cell><Table.Cell>The data are not valid base64 data</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>INVALID_DATA</Table.Cell><Table.Cell>The data are not valid according to the validation parameters set for this experiment.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>SESSION_LIMIT_REACHED</Table.Cell><Table.Cell>The session limit for this experiment has been reached</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>UNKNOWN_ERROR_GETTING_CONDITION</Table.Cell><Table.Cell>An unknown error occurred while getting the condition for this experiment</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>OSF_FILE_EXISTS</Table.Cell><Table.Cell>The OSF file already exists. File names must be unique.</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>OSF_UPLOAD_ERROR</Table.Cell><Table.Cell>An error occurred while uploading the data to OSF</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>INVALID_METADATA_ERROR</Table.Cell><Table.Cell>Metadata produced from incoming data is invalid</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>OSF_METADATA_UPLOAD_ERROR</Table.Cell><Table.Cell>An error occured while uploading metadata to OSF</Table.Cell></Table.Row>
            <Table.Row><Table.Cell>METADATA_ERROR</Table.Cell><Table.Cell>An error occurred while processing metadata</Table.Cell></Table.Row>
          </Table.Body>
        </Table.Root>
      </Stack>
    </Stack>
  );
}
