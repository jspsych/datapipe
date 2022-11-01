import Link from 'next/link';
import { useContext } from 'react';
import { UserContext } from '../lib/context';
import { Stack, Heading, Text, Button } from '@chakra-ui/react';

export default function Home() {

  const { user } = useContext(UserContext);

  return (
    <Stack>
      <Heading>OSF Relay</Heading>
      <Text>Connect your behavioral experiments to the OSF, for free.</Text>
      {user ? 
        <Link href="/admin">Go to Dashboard</Link>
        :
        <Link href="/signup">
          <Button variant={"solid"} colorScheme={"green"} size={"md"}>
            Create an Account
          </Button>
        </Link>
      }
    </Stack>
  )
}
