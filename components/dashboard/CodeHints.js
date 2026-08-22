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
      {/* The `xs` / uppercase / letterSpacing / gray.500 "INTEGRATION CODE"
          eyebrow that used to sit here is gone: 3.43:1 against the dark page,
          and DESIGN.md §8.1 bans the pattern outright. The section now gets a
          real <h2> from SettingsSection on pages/admin/[experiment_id].js,
          with the description this block never had. */}
      <HStack justifyContent="flex-end" flexWrap="wrap" gap={2}>
        <Menu.Root>
          <Menu.Trigger asChild>
            {/* fg.muted -> fg on hover (8.30/9.14 -> 13.16/12.94), replacing
                gray.400 -> literal white. */}
            <Button
              variant="ghost"
              color="fg.muted"
              size="xs"
              _hover={{ color: "fg", bg: "bg.muted" }}
            >
              {language} <ChevronDown size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Positioner>
            {/* bg.panel + border, replacing greyBackground + whiteAlpha.300
                (1.26:1 -- an absent edge, and a banned value per §1). The
                menu floats over the PAGE, so unlike CodeBlock it is
                mode-aware, not part of the invariant code device. */}
            <Menu.Content
              bg="bg.panel"
              color="fg"
              borderWidth="1px"
              borderColor="border"
              p="1"
            >
              <Menu.Item
                value="jspsych"
                py="2"
                px="3"
                _hover={{ bg: "bg.muted" }}
                onClick={() => setLanguage("jsPsych v8")}
              >
                jsPsych v8
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                value="javascript"
                py="2"
                px="3"
                _hover={{ bg: "bg.muted" }}
                onClick={() => setLanguage("JavaScript")}
              >
                JavaScript
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>
      </HStack>
      {language === "jsPsych v8" && (
        <Tabs.Root variant="enclosed" colorPalette="brandGreen" defaultValue="send-data" size="sm">
          <Tabs.List>
            <Tabs.Trigger value="send-data">Save data</Tabs.Trigger>
            <Tabs.Trigger value="send-base64">Save file</Tabs.Trigger>
            <Tabs.Trigger value="get-condition">Conditions</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="send-data">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
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
              <Text fontSize="sm" color="fg.muted">
                Use .json() and a .json filename to save as JSON instead of CSV.
              </Text>
            </VStack>
          </Tabs.Content>
          <Tabs.Content value="send-base64">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
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
              <Text fontSize="sm" color="fg.muted">
                saveBase64Data is async. Use the plugin with action: "saveBase64" if you need to wait for confirmation before continuing.
              </Text>
            </VStack>
          </Tabs.Content>
          <Tabs.Content value="get-condition">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
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
        <Tabs.Root variant="enclosed" colorPalette="brandGreen" defaultValue="send-data-js" size="sm">
          <Tabs.List>
            <Tabs.Trigger value="send-data-js">Save data</Tabs.Trigger>
            <Tabs.Trigger value="send-base64-js">Save file</Tabs.Trigger>
            <Tabs.Trigger value="get-condition-js">Conditions</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="send-data-js">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
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
              <Text fontSize="sm" color="fg.muted">
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
              <Text fontSize="sm" color="fg.muted">
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
