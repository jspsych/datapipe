import { useContext, useEffect, useState } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { HStack, Text } from "@chakra-ui/react";
import { Button } from "@chakra-ui/react";
import { OsfIcon } from "../OsfIcon";


export default function OneClickAuth() {
    const [redirectState] = useState(() => crypto.randomUUID().substring(0, 6));
    useEffect(() => {
        localStorage.setItem('latestCSRFToken', redirectState);
        console.log('OneClickAuth - CSRF Token set:', redirectState);
    }, [redirectState]);

    const { user } = useContext(UserContext);

    const [data, loading, error, snapshot, reload] = useDocumentData(
        doc(db, "users", user.uid)
    );

    const handleAuthClick = () => {
        localStorage.setItem('osfAuthFlow', 'linking'); // Mark this as linking flow for existing users
        
        const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
        const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
        const scope = "osf.full_write"
        const url = `https://accounts.osf.io/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${redirectState}&scope=${scope}&access_type=offline&approval_prompt=force`;
        window.location.href = url;
    }

    return (
        <HStack justifyContent="space-between" w="100%">
            <HStack>
                <Text fontSize={"lg"}>One-Click Authentication</Text>
            </HStack>
            <Button colorScheme="blue" leftIcon={<OsfIcon />} onClick={handleAuthClick}>
                Link OSF Account
            </Button>
        </HStack>
    );
}