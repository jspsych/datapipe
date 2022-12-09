import AuthCheck from "../../components/AuthCheck";
import { useRouter } from "next/router";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { db } from "../../lib/firebase";
import { doc, setDoc } from "firebase/firestore";

import { Spinner, Flex, VStack } from "@chakra-ui/react";

import Title from "../../components/dashboard/Title";
import ExperimentInfo from "../../components/dashboard/ExperimentInfo";
import ExperimentActive from "../../components/dashboard/ExperimentActive";
import ExperimentValidation from "../../components/dashboard/ExperimentValidation";
import CodeHints from "../../components/dashboard/CodeHints";

import { useState } from "react";

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
        <VStack alignSelf="flex-start" align="flex-start" w={1000}>
          <Title
            title={data.title}
            onSubmit={(newTitle) => {
              if (data.title !== newTitle) {
                updateExperimentTitle(newTitle, experiment_id);
              }
            }}
          />
          <Flex alignItems="flex-start" wrap="wrap" w="100%">
            <VStack w="40%">
              <ExperimentInfo data={data} />
              <ExperimentActive data={data} />
              <ExperimentValidation data={data} />
            </VStack>
            <CodeHints expId={experiment_id} />
          </Flex>
        </VStack>
      )}
    </>
  );
}

async function updateExperimentTitle(newTitle, expId) {
  try {
    await setDoc(
      doc(db, `experiments/${expId}`),
      {
        title: newTitle,
      },
      { merge: true }
    );
  } catch (error) {
    console.error(error);
  }
}

