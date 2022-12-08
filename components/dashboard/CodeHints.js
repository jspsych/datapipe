import {
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  VStack,
  Text,
} from "@chakra-ui/react";

import CodeBlock from "../CodeBlock";

export default function CodeHints({ expId }) {
  return (
    <Tabs variant="solid-rounded" colorScheme="brandOrange">
      <TabList>
        <Tab>jsPsych</Tab>
        <Tab>JavaScript</Tab>
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
              To save data, add this trial to your timeline after all data is
              collected:
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
          <VStack alignItems={"start"}>
            <Text>Use fetch to send data:</Text>
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
      </TabPanels>
    </Tabs>
  );
}