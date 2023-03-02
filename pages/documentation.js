import {
  Heading,
  Stack,
  Text,
  TableContainer,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
} from "@chakra-ui/react";
import MESSAGES from "../functions/api-messages.js";

function ErrorTable({ rows }) {
  return (
    <TableContainer>
      <Table variant="striped" colorScheme="brandTeal">
        <Thead>
          <Tr>
            <Th textColor={"white"}>Name</Th>
            <Th textColor={"white"}>Description</Th>
          </Tr>
        </Thead>
        <Tbody>{rows}</Tbody>
      </Table>
    </TableContainer>
  );
}

function MessageRow({ name, description }) {
  return (
    <Tr>
      <Th textColor={"white"}>{name}</Th>
      <Th textColor={"white"}>{description}</Th>
    </Tr>
  );
}

let SUCCESS = {
  error: "SUCCESS",
  message: "The request completed successfully.",
};
let generalMessages = [
  SUCCESS,
  MESSAGES.MISSING_PARAMETER,
  MESSAGES.EXPERIMENT_NOT_FOUND,
  MESSAGES.DATA_COLLECTION_NOT_ACTIVE,
  MESSAGES.SESSION_LIMIT_REACHED,
  MESSAGES.INVALID_DATA,
  MESSAGES.INVALID_OWNER,
  MESSAGES.INVALID_OSF_TOKEN,
  MESSAGES.OSF_FILE_EXISTS,
  MESSAGES.OSF_UPLOAD_ERROR,
];
let generalRows = [];
generalMessages.forEach((item) => {
  generalRows.push(<MessageRow name={item.error} description={item.message} />);
});

let base64Messages = [
  MESSAGES.BASE64DATA_COLLECTION_NOT_ACTIVE,
  MESSAGES.INVALID_BASE64_DATA,
];
let base64Rows = [];
base64Messages.forEach((item) => {
  base64Rows.push(<MessageRow name={item.error} description={item.message} />);
});

let conditionMessages = [
  MESSAGES.CONDITION_ASSIGNMENT_NOT_ACTIVE,
  MESSAGES.UNKNOWN_ERROR_GETTING_CONDITION,
];
let conditionRows = [];
conditionMessages.forEach((item) => {
  conditionRows.push(
    <MessageRow name={item.error} description={item.message} />
  );
});

export default function Documentation() {
  return (
    <Stack w={["95%", 960]} my={10} spacing={4}>
      <Heading as="h1">Documentation</Heading>
      <Text>
        This serves as a documentation for the DataPipe system, along with error
        messages that you may attain when using the system.
      </Text>
      <Heading as="h2" fontSize="2xl">
        General
      </Heading>
      <ErrorTable rows={generalRows} />
      <Heading as="h2" fontSize="2xl">
        Base-64
      </Heading>
      <ErrorTable rows={base64Rows} />
      <Heading as="h2" fontSize="2xl">
        Condition
      </Heading>
      <ErrorTable rows={conditionRows} />
    </Stack>
  );
}
