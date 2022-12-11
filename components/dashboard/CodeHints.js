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
          <MenuButton
            as={Button}
            variant="outline"
            colorScheme="white"
            rightIcon={<ChevronDownIcon />}
          >
            {language}
          </MenuButton>
          <MenuList bg="black" variant="outline">
            <MenuItem bg="black" onClick={() => setLanguage("jsPsych")}>
              jsPsych
            </MenuItem>
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
                action: "save",
                experiment_id: "${expId}",
                filename: filename,
                data: ()=>jsPsych.data.get().csv()
              };`}
                </CodeBlock>
                <Text>
                  Note that you can also save the data as JSON by changing the
                  file name and using .json() instead of .csv() to get the
                  jsPsych data.
                </Text>
              </VStack>
            </TabPanel>
            <TabPanel>
              <VStack alignItems={"start"}>
                <Text>Load the pipe plugin:</Text>
                <CodeBlock>
                  {`<script src="https://unpkg.com/@jspsych-contrib/jspsych-pipe"></script>`}
                </CodeBlock>
                <Text>
                  This example will imagine that you are recording audio data
                  from the html-audio-response plugin and sending the file at
                  the end of the trial. There are other ways that you could use
                  this, but this method will illustrate the key ideas.
                </Text>
                <Text>
                  In the on_finish event, we can send the data using the static
                  method of the pipe plugin.
                </Text>
                <CodeBlock>
                  {`
                  var trial = {
                    type: jsPsychHtmlAudioResponse,
                    stimulus: \`
                        <p>Please record a few seconds of audio and click the button when you are done.</p>
                    \`,
                    recording_duration: 15000,
                    allow_playback: true,
                    on_finish: function(data){
                      const filename = \`\${subject_id}_\${jsPsych.getProgress().current_trial_global}_audio.webm\`;
                      jsPsychPipe.saveBase64Data("${expId}",  filename, data.response);
                      // delete the base64 data to save space. store the filename instead.
                      data.response = filename;
                    }
                  };
                `}
                </CodeBlock>
                <Text>
                  The jsPsych.saveBase64Data method is asynchronous, so if you
                  want to wait for confirmation that the file was saved before
                  moving on you can use the plugin instead. If you are
                  comfortable with asynchronous programming then async/await
                  will work too.
                </Text>
                <CodeBlock>
                  {`
              const save_data = {
                type: jsPsychPipe,
                action: "saveBase64",
                experiment_id: "${expId}",
                filename: filename,
                data: ()=>{
                  // get the last trial's response (imagine that this is the audio data)
                  return jsPsych.data.get().last(1).values()[0].response;
                }
              };`}
                </CodeBlock>
              </VStack>
            </TabPanel>
            <TabPanel>
              <VStack alignItems={"start"}>
                <Text>Load the pipe plugin:</Text>
                <CodeBlock>
                  {`<script src="https://unpkg.com/@jspsych-contrib/jspsych-pipe"></script>`}
                </CodeBlock>
                <Text>Use the static method of the pipe plugin to request the condition. This is an asynchronous request so we need to wait for the response before using the condition value. An easy wait to do this is to put your experiment creation code inside an async function.</Text>
                <CodeBlock>
                  {`
                  async function createExperiment(){
                    const condition = await jsPsychPipe.getCondition("${expId}");
                    if(condition == 0) { timeline = condition_1_timeline; }
                    if(condition == 1) { timeline = condition_2_timeline; }
                    jsPsych.run(timeline);
                  }
                  createExperiment();
                  `}
                </CodeBlock>
              </VStack>
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
                <Text>
                  Use fetch to send base64 data. The server will decode the
                  base64 and send the decoded file to the OSF. Use the
                  appropriate file extension in the file name.
                </Text>
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
                <Text>
                  This request is asynchronous, so you will need to wrap this in
                  an async function. The value of condition will be a string.
                </Text>
              </VStack>
            </TabPanel>
          </TabPanels>
        </Tabs>
      )}
    </Stack>
  );
}
