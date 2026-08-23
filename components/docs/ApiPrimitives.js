import { Stack, Heading, Text, Table, Badge, Code } from "@chakra-ui/react";

/**
 * ApiPrimitives
 *
 * EndpointHeading, ParamTable, Param and ErrorRow, lifted verbatim from
 * pages/api-docs.js:16-65 (docs IA plan §3.6 / §4 Package A). The only
 * change is the raw-color -> semantic-token conversion required to ship
 * these inside components/docs and pages/docs at all:
 *   color="white"  -> color="fg"       (Table.ColumnHeader)
 *   color="gray.400" -> color="fg.muted" (Param / ErrorRow secondary text)
 *
 * Package D (docs IA plan §4) reuses these unchanged for /docs/api's moved
 * API reference content.
 */
export const BASE_URL = "https://pipe.jspsych.org";

export function EndpointHeading({ method, path, children }) {
  return (
    <Stack gap={3}>
      <Heading as="h3" fontSize="md" fontWeight="600" color="fg">
        {children}
      </Heading>
      <Text>
        <Badge colorPalette="brandGreen" mr={2}>
          {method}
        </Badge>
        <Code>
          {BASE_URL}
          {path}
        </Code>
      </Text>
    </Stack>
  );
}

export function ParamTable({ children }) {
  return (
    <Table.Root variant="outline">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader color="fg">Field</Table.ColumnHeader>
          <Table.ColumnHeader color="fg">Type</Table.ColumnHeader>
          <Table.ColumnHeader color="fg">Description</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>{children}</Table.Body>
    </Table.Root>
  );
}

export function Param({ name, type, children }) {
  return (
    <Table.Row>
      <Table.Cell>
        <Code>{name}</Code>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm" color="fg.muted">
          {type}
        </Text>
      </Table.Cell>
      <Table.Cell>{children}</Table.Cell>
    </Table.Row>
  );
}

export function ErrorRow({ code, status, children }) {
  return (
    <Table.Row>
      <Table.Cell>
        <Code>{code}</Code>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm" color="fg.muted">
          {status}
        </Text>
      </Table.Cell>
      <Table.Cell>{children}</Table.Cell>
    </Table.Row>
  );
}
