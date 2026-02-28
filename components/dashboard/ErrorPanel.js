import {
  Box,
  Accordion,
  Alert,
  Table,
} from "@chakra-ui/react";

export default function ErrorPanel({ errors }) {

  return (
    <Alert.Root status="error" variant="solid">
      <Alert.Indicator />
      <Box flex="1">
        <Alert.Title mb={4}>There was an error in data upload.</Alert.Title>
        <Accordion.Root collapsible>
          <Accordion.Item value="error-logs">
            <Accordion.ItemTrigger>
              <Box as="span" flex="1" textAlign="left">
                See Error Logs
              </Box>
              <Accordion.ItemIndicator />
            </Accordion.ItemTrigger>
            <Accordion.ItemContent pb={4}>
              <Table.Root variant="line">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>ERROR</Table.ColumnHeader>
                    <Table.ColumnHeader>TIME</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {errors.map((error, index) => (
                    <Table.Row key={index}>
                      <Table.Cell>{error.error}</Table.Cell>
                      <Table.Cell>{error.time}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Accordion.ItemContent>
          </Accordion.Item>
        </Accordion.Root>
      </Box>
    </Alert.Root>
  );
}
