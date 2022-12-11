import AuthCheck from "../../components/AuthCheck";
import { useRouter } from "next/router";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { db } from "../../lib/firebase";
import { doc } from "firebase/firestore";

import { Spinner, Flex, VStack } from "@chakra-ui/react";

import Title from "../../components/dashboard/Title";
import ExperimentInfo from "../../components/dashboard/ExperimentInfo";
import ExperimentActive from "../../components/dashboard/ExperimentActive";
import ExperimentValidation from "../../components/dashboard/ExperimentValidation";
import CodeHints from "../../components/dashboard/CodeHints";

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

  return (
    <>
      {loading && <Spinner color="green.500" size={"xl"} />}
      {data && (
        <VStack alignSelf="flex-start" align="flex-start" w={1200}>
          <Title data={data} />
          <Flex alignItems="flex-start" wrap="wrap" w="100%" justifyContent="space-between">
            <VStack w="38%">
              <ExperimentInfo data={data} />
              <ExperimentActive data={data} />
              <ExperimentValidation data={data} />
            </VStack>
            <VStack w="60%">
              <CodeHints expId={experiment_id} />
            </VStack>
          </Flex>
        </VStack>
      )}
    </>
  );
}
