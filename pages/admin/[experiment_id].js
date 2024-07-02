import AuthCheck from "../../components/AuthCheck";
import { useRouter } from "next/router";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { db } from "../../lib/firebase";
import { doc } from "firebase/firestore";

import { Spinner, Flex, VStack, Text } from "@chakra-ui/react";

import Title from "../../components/dashboard/Title";
import ExperimentInfo from "../../components/dashboard/ExperimentInfo";
import ExperimentActive from "../../components/dashboard/ExperimentActive";
import ExperimentValidation from "../../components/dashboard/ExperimentValidation";
import MetadataControl from "../../components/dashboard/MetadataControl";
import CodeHints from "../../components/dashboard/CodeHints";
import ErrorPanel from "../../components/dashboard/ErrorPanel";

export default function ExperimentPage() {
  const router = useRouter();
  const { experiment_id } = router.query;

  return (
    <AuthCheck>
      <ExperimentPageDashboard experiment_id={experiment_id} />
    </AuthCheck>
  );
}

function ExperimentPageDashboard({ experiment_id }) {
  const [data, loading, error, snapshot, reload] = useDocumentData(
    doc(db, `experiments/${experiment_id}`)
  );
  const logs = useDocumentData(
    doc(db, `logs/${experiment_id}`))?.[0] || null;

  const uploadError = logs?.logError;
  const errorLog = logs?.errors;

  console.log(errorLog);

  return (
    <>
      {loading && <Spinner color="green.500" size={"xl"} />}
      {error && <Text>This experiment does not exist.</Text>}
      {data && (
        <VStack alignSelf="flex-start" align="flex-start" w={["99vw", 1200]}>
          <Title data={data} />
          <Flex
            alignItems="flex-start"
            wrap="wrap"
            w="100%"
            justifyContent="space-between"
          >
            <VStack w={["100%", "38%"]}>
              <ExperimentInfo data={data} />
              <MetadataControl data={data} />
              <ExperimentActive data={data} />
              <ExperimentValidation data={data} />
            </VStack>
            <VStack w={["100%", "60%"]}>
            {uploadError && <ErrorPanel errors={errorLog} />}
              <CodeHints expId={experiment_id} />
            </VStack>
          </Flex>
        </VStack>
      )}
    </>
  );
}
