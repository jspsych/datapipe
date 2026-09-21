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
import { extensionSnippet } from "./extension-snippet";
import { EXTENSION_PIPE_SCRIPT, DATAPIPE_CLIENT_SCRIPT } from "./script-tags";

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
              p="2"
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

          {/* The extension is the whole integration: registering it saves the
              data, so there is no save trial and no separate "save as you go"
              path to choose between. Streaming is simply on. */}
          <Tabs.Content value="send-data">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
                Load the extension and register it. That is the whole integration — there is no save trial to add.
              </Text>
              <CodeBlock language="html">
                {EXTENSION_PIPE_SCRIPT}
              </CodeBlock>
              <CodeBlock>{extensionSnippet(expId)}</CodeBlock>
              <Text fontSize="sm" color="fg.muted">
                Each trial is sent as it happens, so a participant who closes the tab partway through does not take all of their data with them: their completed trials arrive as a separate file ending in .partial.json, and do not count toward your session limit. A participant who finishes produces one ordinary file.
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Add format: &quot;json&quot; to save JSON instead of CSV. Add stream: false to send only at the end.
              </Text>
            </VStack>
          </Tabs.Content>
          <Tabs.Content value="send-base64">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
                Use saveBase64Data to upload binary files (audio, video, images). This example saves audio from the html-audio-response plugin.
              </Text>
              <CodeBlock language="html">
                {EXTENSION_PIPE_SCRIPT}
              </CodeBlock>
              <CodeBlock>
                {`
              var trial = {
                type: jsPsychHtmlAudioResponse,
                stimulus: "<p>Record a few seconds of audio.</p>",
                recording_duration: 15000,
                on_finish: async function(data){
                  const filename = \`\${subject_id}_\${jsPsych.getProgress().current_trial_global}_audio.webm\`;
                  await jsPsychExtensionPipe.saveBase64Data("${expId}", filename, data.response);
                  data.response = filename;
                }
              };`}
              </CodeBlock>
              <Text fontSize="sm" color="fg.muted">
                jsPsych waits for an async on_finish, so awaiting the upload keeps the timeline paused until the file has been sent. Drop the await to let it finish in the background.
              </Text>
            </VStack>
          </Tabs.Content>
          <Tabs.Content value="get-condition">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
                Request the next condition assignment. This is async, so wrap your experiment in an async function.
              </Text>
              <CodeBlock language="html">
                {EXTENSION_PIPE_SCRIPT}
              </CodeBlock>
              <CodeBlock>
                {`
              async function createExperiment(){
                let condition;
                try {
                  condition = await jsPsychExtensionPipe.getCondition("${expId}");
                } catch (error) {
                  document.body.innerHTML = "<p>The experiment could not be started.</p>";
                  throw error;
                }

                if(condition == 0) { timeline = condition_1_timeline; }
                if(condition == 1) { timeline = condition_2_timeline; }
                jsPsych.run(timeline);
              }
              createExperiment();`}
              </CodeBlock>
              <Text fontSize="sm" color="fg.muted">
                getCondition throws if the assignment cannot be made — the experiment is closed, or condition assignment is switched off. There is no safe value to fall back to, so decide what the participant sees rather than letting them run the wrong condition.
              </Text>
            </VStack>
          </Tabs.Content>
        </Tabs.Root>
      )}
      {language === "JavaScript" && (
        <Tabs.Root variant="enclosed" colorPalette="brandGreen" defaultValue="send-data-js" size="sm">
          <Tabs.List>
            <Tabs.Trigger value="send-data-js">Save data</Tabs.Trigger>
            <Tabs.Trigger value="stream-data-js">Save as you go</Tabs.Trigger>
            <Tabs.Trigger value="send-base64-js">Save file</Tabs.Trigger>
            <Tabs.Trigger value="get-condition-js">Conditions</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="send-data-js">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
                Send your data as a string with a unique filename.
              </Text>
              <CodeBlock language="html">
                {DATAPIPE_CLIENT_SCRIPT}
              </CodeBlock>
              <CodeBlock>
                {`
            const result = await DataPipe.saveData({
              experimentID: "${expId}",
              filename: "UNIQUE_FILENAME.csv",
              data: dataAsString,
            });

            if (!result.ok) {
              console.error(\`DataPipe refused the data (HTTP \${result.status})\`, result.body);
            }`}
              </CodeBlock>
              <Text fontSize="sm" color="fg.muted">
                saveData never throws. Check result.ok to find out whether the data arrived.
              </Text>
            </VStack>
          </Tabs.Content>
          {/* Every JavaScript tab uses datapipe-client, but this is the one
              that could not be rewritten as a raw fetch: staging a trial means
              writing to a database directly, not calling a DataPipe endpoint. */}
          <Tabs.Content value="stream-data-js">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
                Send each trial as it happens, so a participant who closes the tab partway through does not take all of their data with them.
              </Text>
              <CodeBlock language="html">
                {DATAPIPE_CLIENT_SCRIPT}
              </CodeBlock>
              <CodeBlock>
                {`
            const filename = "UNIQUE_FILENAME.csv";
            const session = DataPipe.createSession({
              experimentID: "${expId}",
              filename: filename,
            });

            // ...after each trial:
            session.record(trialData);

            // ...when the experiment ends:
            await session.flush();
            const result = await DataPipe.saveData({
              experimentID: "${expId}",
              filename: filename,
              data: dataAsString,
              sessionId: session.sessionId,
            });
            await session.close({ submitted: result.ok });`}
              </CodeBlock>
              <Text fontSize="sm" color="fg.muted">
                Flush before reading sessionId: the session starts in the background, and until it has, the id is empty. Submitting without it leaves the staged copy unmatched, and it comes back as a duplicate .partial.json.
              </Text>
              <Text fontSize="sm" color="fg.muted">
                A participant who finishes produces one ordinary file. One who quits partway produces a separate file ending in .partial.json, holding the trials they completed. Partial sessions do not count toward your session limit.
              </Text>
            </VStack>
          </Tabs.Content>
          <Tabs.Content value="send-base64-js">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
                Send binary data (audio, video, images) as a base64 string. DataPipe decodes it and uploads the file to your storage provider.
              </Text>
              <CodeBlock language="html">
                {DATAPIPE_CLIENT_SCRIPT}
              </CodeBlock>
              <CodeBlock>
                {`
            const result = await DataPipe.saveBase64Data({
              experimentID: "${expId}",
              filename: "UNIQUE_FILENAME.webm",
              data: base64DataString,
            });`}
              </CodeBlock>
            </VStack>
          </Tabs.Content>
          <Tabs.Content value="get-condition-js">
            <VStack alignItems={"start"} gap={3}>
              <Text fontSize="sm" color="fg.muted">
                Request the next condition assignment, a number starting at 0.
              </Text>
              <CodeBlock language="html">
                {DATAPIPE_CLIENT_SCRIPT}
              </CodeBlock>
              <CodeBlock>
                {`
            let condition;
            try {
              condition = await DataPipe.getCondition({ experimentID: "${expId}" });
            } catch (error) {
              document.body.innerHTML = "<p>The experiment could not be started.</p>";
              throw error;
            }`}
              </CodeBlock>
              <Text fontSize="sm" color="fg.muted">
                getCondition throws if the assignment cannot be made — the experiment is closed, or condition assignment is switched off. There is no safe value to fall back to, so decide what the participant sees rather than letting them run the wrong condition.
              </Text>
            </VStack>
          </Tabs.Content>
        </Tabs.Root>
      )}
    </Stack>
  );
}
