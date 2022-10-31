import AuthCheck from '../../components/AuthCheck';
import { useRouter } from 'next/router';
import { useDocumentData } from 'react-firebase-hooks/firestore';
import { db, auth } from '../../lib/firebase';
import { doc, setDoc } from "firebase/firestore";

import { FormControl, Stack, Spinner, Input, InputGroup, InputLeftAddon, Checkbox, FormLabel, Button } from '@chakra-ui/react';

export default function ExperimentPage() {

  const router = useRouter();
  const { experiment_id } = router.query;

  return (
    <AuthCheck>
      <ExperimentEditForm expId={experiment_id} />
    </AuthCheck>
  )
}

function ExperimentEditForm({expId}) {

  const [data, loading, error, snapshot, reload] = useDocumentData(doc(db, `experiments/${expId}`));
  return (
    <>
      {loading && <Spinner color="green.500" size={"xl"} />}
      {data &&
      <Stack>
        <FormControl id="title">
          <FormLabel>Title</FormLabel>
          <Input type="text" defaultValue={data.title} />
        </FormControl>
        <FormControl id="osf-repo">
          <FormLabel>OSF Repo</FormLabel>
          <Input type="text" defaultValue={data.osfRepo} />
        </FormControl>
        <FormControl id="active">
          <FormLabel>Active</FormLabel>
          <Checkbox defaultChecked={data.active} />
        </FormControl>
        <Button
          variant={"solid"}
          colorScheme={"green"}
          size={"md"}
          mr={4}
          onClick={() => handleSaveButton(expId)}
        >
          Save
        </Button>
      </Stack>}
    </>
  )
}

async function handleSaveButton(expId) {
  try {
    await setDoc(doc(db, `experiments/${expId}`), {
      title: document.querySelector('#title').value,
      osfRepo: document.querySelector('#osf-repo').value,
      active: document.querySelector('#active').checked,
    }, {merge: true});
  }
  catch (error) {
    console.error(error);
  }
}