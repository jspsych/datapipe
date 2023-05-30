import {
  Stack,
  Heading,
  Text,
  Button,
  Link,
  OrderedList,
  ListItem,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Code
} from "@chakra-ui/react";

export default function ApiDocs() {
  return (
    <Stack w={["95%", 960]} spacing={10}>

      <Stack spacing={2}>
        <Heading as="h1" size="xl">
          API Documentation
        </Heading>
        <Text>
          Using the API requires setting up an experiment to obtain an experiment ID.
          Code examples for using JavaScript and jsPsych are available in the experiment dashboard.
        </Text>
      </Stack>

      <Stack spacing={2}>
        <Heading as="h2" size="md">
          Save text-based data
        </Heading>
        <Text>
          <Badge colorScheme="green">POST</Badge> /api/data
        </Text>
        <Text>
          Save a text-based data file to the OSF. The data can be optionally validated by setting up validation
          rules in the experiment configuration.
        </Text>
        <Table variant="simple">
          <Thead>
            <Tr>
              <Th color="white">Parameter</Th>
              <Th color="white">Description</Th>
            </Tr>
          </Thead>
          <Tbody>
            <Tr>
              <Td>experimentID</Td>
              <Td>The ID of the experiment to save data for. This ID is provided when an experiment is created on DataPipe.</Td>
            </Tr>
            <Tr>
              <Td>data</Td>
              <Td>The text-based data to save, sent as a string.</Td>
            </Tr>
            <Tr>
              <Td>filename</Td>
              <Td>The name of the file to create. This filename must be unique. If the file already exists the request will fail.</Td>
            </Tr>
          </Tbody>
        </Table>
      </Stack>
      <Stack spacing={2}>
        <Heading as="h2" size="md">
          Save base64-encoded data
        </Heading>
        <Text>
          <Badge colorScheme="green">POST</Badge> /api/base64
        </Text>
        <Text>
          Save a base64-encoded file to the OSF. The file will be decoded before being posted to the OSF.
        </Text>
        <Table variant="simple">
          <Thead>
            <Tr>
              <Th color="white">Parameter</Th>
              <Th color="white">Description</Th>
            </Tr>
          </Thead>
          <Tbody>
            <Tr>
              <Td>experimentID</Td>
              <Td>The ID of the experiment to save data for. This ID is provided when an experiment is created on DataPipe.</Td>
            </Tr>
            <Tr>
              <Td>data</Td>
              <Td>The base64-encoded data to save, sent as a string.</Td>
            </Tr>
            <Tr>
              <Td>filename</Td>
              <Td>The name of the file to create. This filename must be unique. If the file already exists the request will fail.</Td>
            </Tr>
          </Tbody>
        </Table>
      </Stack>
      <Stack spacing={2}>
        <Heading as="h2" size="md">
          Get condition assignment
        </Heading>
        <Text>
          <Badge colorScheme="green">POST</Badge> /api/condition
        </Text>
        <Text>
          Get the next condition assignment in an experiment. The condition is a numerical value from 0 to n-1, where n
          is the number of conditions in the experiment. Condition assignment is sequential, so the first request will
          return 0, the second request will return 1, and so on.
        </Text>
        <Table variant="simple">
          <Thead>
            <Tr>
              <Th color="white">Parameter</Th>
              <Th color="white">Description</Th>
            </Tr>
          </Thead>
          <Tbody>
            <Tr>
              <Td>experimentID</Td>
              <Td>The ID of the experiment. This ID is provided when an experiment is created on DataPipe.</Td>
            </Tr>
          </Tbody>
        </Table>
        <Text>
          On a successful request, the JSON response will contain a <Code>condition</Code> parameter with the condition assignment.
        </Text>
      </Stack>
      <Stack spacing={2}>
        <Heading as="h2" size="md">
          API Responses
        </Heading>
        <Text>Responses from the API are JSON. On a successful request the response will contain a <Code>message</Code>{' '}
          parameter will the value <Code>Success</Code>. When an error occurs, the responses will contain one of the <Code>error</Code>{' '}
          and <Code>message</Code> parameter sets shown below.</Text>
        <Table variant="simple">
          <Thead>
            <Tr>
              <Th color="white">Error</Th>
              <Th color="white">Message</Th>
            </Tr>
          </Thead>
          <Tbody>
            <Tr>
              <Td>MISSING_PARAMETER</Td>
              <Td>One or more required parameters are missing.</Td>
            </Tr>
            <Tr>
              <Td>DATA_COLLECTION_NOT_ACTIVE</Td>
              <Td>Data collection is not active for this experiment</Td>
            </Tr>
            <Tr>
              <Td>BASE64DATA_COLLECTION_NOT_ACTIVE</Td>
              <Td>Base64 data collection is not active for this experiment</Td>
            </Tr>
            <Tr>
              <Td>CONDITION_ASSIGNMENT_NOT_ACTIVE</Td>
              <Td>Condition assignment is not active for this experiment</Td>
            </Tr>
            <Tr>
              <Td>EXPERIMENT_NOT_FOUND</Td>
              <Td>The experiment ID does not match an experiment</Td>
            </Tr>
            <Tr>
              <Td>INVALID_OWNER</Td>
              <Td>The owner ID of this experiment does not match a valid user</Td>
            </Tr>
            <Tr>
              <Td>INVALID_OSF_TOKEN</Td>
              <Td>The OSF token for this experiment is not valid</Td>
            </Tr>
            <Tr>
              <Td>INVALID_BASE64_DATA</Td>
              <Td>The data are not valid base64 data</Td>
            </Tr>
            <Tr>
              <Td>INVALID_DATA</Td>
              <Td>
                The data are not valid according to the validation parameters set
                for this experiment.
              </Td>
            </Tr>
            <Tr>
              <Td>SESSION_LIMIT_REACHED</Td>
              <Td>The session limit for this experiment has been reached</Td>
            </Tr>
            <Tr>
              <Td>UNKNOWN_ERROR_GETTING_CONDITION</Td>
              <Td>
                An unknown error occurred while getting the condition for this
                experiment
              </Td>
            </Tr>
            <Tr>
              <Td>OSF_FILE_EXISTS</Td>
              <Td>
                The OSF file already exists. File names must be unique.
              </Td>
            </Tr>
            <Tr>
              <Td>OSF_UPLOAD_ERROR</Td>
              <Td>An error occurred while uploading the data to OSF</Td>
            </Tr>
          </Tbody>
        </Table>
      </Stack>
    </Stack>
  );
}
