import {
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  VStack,
  Text,
  Heading,
  Stack,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuDivider,
  Button,
} from "@chakra-ui/react";
import { useState } from "react";
import { ChevronDownIcon } from "@chakra-ui/icons";

import CodeBlock from "../CodeBlock";

export default function CodeHints({ expId }) {
  const [language, setLanguage] = useState("jsPsych");

  return (
    <Stack
      pr={8}
      spacing={6}
      bgColor={"black"}
      borderRadius={16}
      p={6}
      w={"100%"}
    >
      <Heading fontSize="2xl">Code Samples</Heading>
      <VStack alignItems="flex-start">
        <Text>Select language</Text>
        <Menu>
          <MenuButton as={Button} variant="outline" colorScheme="white" rightIcon={<ChevronDownIcon />}>
            {language}
          </MenuButton>
          <MenuList bg="black" variant="outline">
            <MenuItem bg="black" onClick={() => setLanguage("jsPsych")}>jsPsych</MenuItem>
            <MenuDivider />
            <MenuItem bg="black" onClick={() => setLanguage("JavaScript")}>
              JavaScript
            </MenuItem>
          </MenuList>
        </Menu>
      </VStack>
      {language === "jsPsych" && (
        <Tabs variant="solid-rounded" colorScheme="brandOrange">
          <TabList>
            <Tab>Send data</Tab>
            <Tab>Send and decode base64 data</Tab>
            <Tab>Get condition assignment</Tab>
          </TabList>

          <TabPanels>
            <TabPanel>
              <VStack alignItems={"start"}>
                <Text>Load the pipe plugin:</Text>
                <CodeBlock>
                  {`<script src="https://unpkg.com/@jspsych-contrib/jspsych-pipe"></script>`}
                </CodeBlock>
                <Text>Generate a unique filename:</Text>
                <CodeBlock>
                  {`
              const subject_id = jsPsych.randomization.randomID(10);
              const filename = \`\${subject_id}.csv\`;
            `}
                </CodeBlock>
                <Text>
                  To save data, add this trial to your timeline after all data
                  is collected:
                </Text>
                <CodeBlock>
                  {`
              const save_data = {
                type: jsPsychPipe,
                experiment_id: "${expId}",
                filename: filename,
                data: ()=>jsPsych.data.get().csv()
              };`}
                </CodeBlock>
              </VStack>
            </TabPanel>
            <TabPanel>
              <VStack alignItems={"start"}></VStack>
            </TabPanel>
          </TabPanels>
        </Tabs>
      )}
      {language === "JavaScript" && (
        <Tabs variant="solid-rounded" colorScheme="brandOrange">
          <TabList>
            <Tab>Send data</Tab>
            <Tab>Send and decode base64 data</Tab>
            <Tab>Get condition assignment</Tab>
          </TabList>

          <TabPanels>
            <TabPanel>
              <VStack alignItems={"start"}>
                <Text>Use fetch to send data.</Text>
                <CodeBlock>
                  {`
            fetch("https://pipe.jspsych.org/api/data/", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "*/*",
              },
              body: JSON.stringify({
                experimentID: "${expId}",
                filename: "UNIQUE_FILENAME.csv",
                data: dataAsString,
              }),
            });`}
                </CodeBlock>
              </VStack>
            </TabPanel>
            <TabPanel>
              <VStack alignItems={"start"}>
              <Text>Use fetch to send base64 data. The server will decode the base64 and send the decoded file to the OSF. Use the appropriate file extension in the file name.</Text>
                <CodeBlock>
                  {`
            fetch("https://pipe.jspsych.org/api/base64/", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "*/*",
              },
              body: JSON.stringify({
                experimentID: "${expId}",
                filename: "UNIQUE_FILENAME.webm",
                data: base64DataString,
              }),
            });`}
                </CodeBlock>
              </VStack>
            </TabPanel>
            <TabPanel>
              <VStack alignItems={"start"}>
              <Text>Use fetch to request the next condition number.</Text>
                <CodeBlock>
                  {`
            const condition = await fetch("https://pipe.jspsych.org/api/condition/", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "*/*",
              },
              body: JSON.stringify({
                experimentID: "${expId}",
              }),
            });`}
                </CodeBlock>
                <Text>This request is asynchronous, so you will need to wrap this in an async function. The value of condition will be a string.</Text>
              </VStack>
            </TabPanel>
          </TabPanels>
        </Tabs>
      )}
    </Stack>
  );
}
