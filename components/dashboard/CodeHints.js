import {
  Tabs,
  VStack,
  Text,
  Stack,
  Menu,
  Button,
  HStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import CodeBlock from "../CodeBlock";

export default function CodeHints({ expId }) {
  const [language, setLanguage] = useState("jsPsych v8");

  return (
    <Stack gap={4} w={"100%"}>
      <HStack justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" color="gray.500">
          Integration Code
        </Text>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button variant="ghost" color="gray.400" size="xs" _hover={{ color: "white" }}>
              {language} <ChevronDown size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Positioner>
            <Menu.Content bg="greyBackground" borderWidth="1px" borderColor="whiteAlpha.300" p="1">
              <Menu.Item
                value="jspsych"
                bg="greyBackground"
                color="white"
                py="2"
                px="3"
                onClick={() => setLanguage("jsPsych v8")}
              >
                jsPsych v8
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                value="javascript"
                bg="greyBackground"
                color="white"
                py="2"
                px="3"
                onClick={() => setLanguage("JavaScript")}
              >
                JavaScript
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>
      </HStack>
      {language === "jsPsych v8" && (
        <Tabs.Root variant="enclosed" colorPalette="brandOrange" defaultValue="send-data" size="sm">
          <Tabs.List>
            <Tabs.Trigger value="send-data">Save data</Tabs.Trigger>
            <Tabs.Trigger value="send-base64">Save file</Tabs.Trigger>
            <Tabs.Trigger value="get-condition">Conditions</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="send-data">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="gray.400">
                Load the plugin, generate a unique filename, and add a save trial to your timeline.
              </Text>
              <CodeBlock language="html">
                {`<script src="https://unpkg.com/@jspsych-contrib/plugin-pipe"></script>`}
              </CodeBlock>
              <CodeBlock>
                {`
              const subject_id = jsPsych.randomization.randomID(10);
              const filename = \`\${subject_id}.csv\`;

              const save_data = {
                type: jsPsychPipe,
                action: "save",
                experiment_id: "${expId}",
                filename: filename,
                data_string: ()=>jsPsych.data.get().csv()
              };`}
              </CodeBlock>
              <Text fontSize="sm" color="gray.400">
                Use .json() and a .json filename to save as JSON instead of CSV.
              </Text>
            </VStack>
          </Tabs.Content>
          <Tabs.Content value="send-base64">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="gray.400">
                Use saveBase64Data to upload binary files (audio, video, images). This example saves audio from the html-audio-response plugin.
              </Text>
              <CodeBlock language="html">
                {`<script src="https://unpkg.com/@jspsych-contrib/plugin-pipe"></script>`}
              </CodeBlock>
              <CodeBlock>
                {`
              const subject_id = jsPsych.randomization.randomID(10);

              var trial = {
                type: jsPsychHtmlAudioResponse,
                stimulus: "<p>Record a few seconds of audio.</p>",
                recording_duration: 15000,
                on_finish: function(data){
                  const filename = \`\${subject_id}_\${jsPsych.getProgress().current_trial_global}_audio.webm\`;
                  jsPsychPipe.saveBase64Data("${expId}", filename, data.response);
                  data.response = filename;
                }
              };`}
              </CodeBlock>
              <Text fontSize="sm" color="gray.400">
                saveBase64Data is async. Use the plugin with action: "saveBase64" if you need to wait for confirmation before continuing.
              </Text>
            </VStack>
          </Tabs.Content>
          <Tabs.Content value="get-condition">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="gray.400">
                Request the next condition assignment. This is async, so wrap your experiment in an async function.
              </Text>
              <CodeBlock language="html">
                {`<script src="https://unpkg.com/@jspsych-contrib/plugin-pipe"></script>`}
              </CodeBlock>
              <CodeBlock>
                {`
              async function createExperiment(){
                const condition = await jsPsychPipe.getCondition("${expId}");
                if(condition == 0) { timeline = condition_1_timeline; }
                if(condition == 1) { timeline = condition_2_timeline; }
                jsPsych.run(timeline);
              }
              createExperiment();`}
              </CodeBlock>
            </VStack>
          </Tabs.Content>
        </Tabs.Root>
      )}
      {language === "JavaScript" && (
        <Tabs.Root variant="enclosed" colorPalette="brandOrange" defaultValue="send-data-js" size="sm">
          <Tabs.List>
            <Tabs.Trigger value="send-data-js">Save data</Tabs.Trigger>
            <Tabs.Trigger value="send-base64-js">Save file</Tabs.Trigger>
            <Tabs.Trigger value="get-condition-js">Conditions</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="send-data-js">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="gray.400">
                POST your data as a string with a unique filename.
              </Text>
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
          </Tabs.Content>
          <Tabs.Content value="send-base64-js">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="gray.400">
                POST base64-encoded binary data. The server decodes and uploads the file to your storage provider.
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
          </Tabs.Content>
          <Tabs.Content value="get-condition-js">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="gray.400">
                Request the next condition number. Returns a JSON object with a condition property.
              </Text>
              <CodeBlock>
                {`
            const response = await fetch("https://pipe.jspsych.org/api/condition/", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "*/*",
              },
              body: JSON.stringify({
                experimentID: "${expId}",
              }),
            });
            const data = await response.json();
            const condition = data.condition;`}
              </CodeBlock>
            </VStack>
          </Tabs.Content>
        </Tabs.Root>
      )}
    </Stack>
  );
}
