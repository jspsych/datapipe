import { useContext } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { HStack, Text } from "@chakra-ui/react";
import { Button } from "@chakra-ui/react";
import { OsfIcon } from "../OsfIcon";


export default function OneClickAuth() {
    const { user } = useContext(UserContext);

    const [data, loading, error, snapshot, reload] = useDocumentData(
        doc(db, "users", user.uid)
    );

    const handleAuthClick = async () => {
        try {
            const stateRes = await fetch(process.env.NEXT_PUBLIC_GENERATE_STATE, { method: 'POST' });
            if (!stateRes.ok) throw new Error('Failed to generate state');
            const { state: redirectState } = await stateRes.json();

            localStorage.setItem('latestCSRFToken', redirectState);
            localStorage.setItem('osfAuthFlow', 'linking');

            const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
            const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
            const scope = "osf.full_write"
            const base_url = `https://accounts.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/oauth2/authorize`;
            const url = `${base_url}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${redirectState}&scope=${scope}&access_type=offline&approval_prompt=force`;
            window.location.href = url;
        } catch (err) {
            console.error('Failed to initiate OSF auth:', err);
        }
    }

    return (
        <HStack justifyContent="space-between" w="100%">
            <HStack>
                <Text fontSize={"lg"}>One-Click Authentication</Text>
            </HStack>
            <Button colorPalette="blue" onClick={handleAuthClick}><OsfIcon />
                Link OSF Account
            </Button>
        </HStack>
    );
}
