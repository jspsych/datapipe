import { HStack, RadioGroup, Radio, Text } from "@chakra-ui/react"
import { useContext } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useState, useEffect } from "react";

export default function SelectAuth() {
    const { user } = useContext(UserContext);

    const [data, loading, error, snapshot, reload] = useDocumentData(
        doc(db, "users", user.uid)
    );

    const [usingPersonalToken, setUsingPersonalToken] = useState(false);

    useEffect(() => {
        if (data && data.usingPersonalToken !== undefined) {
            setUsingPersonalToken(data.usingPersonalToken);
        }
    }, [data]);

    const handleChange = (value) => {
        const usingPersonal = value === "personal";
        setUsingPersonalToken(usingPersonal);

        setDoc(doc(db, "users", user.uid), {
            usingPersonalToken: usingPersonal,
        }, { merge: true });
    }

    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error.message}</div>;

    return (
        <HStack justifyContent="space-between" w="100%">
            <Text fontSize={"lg"}>Authentication Method</Text>
            <RadioGroup
                defaultValue="personal"
                onChange={handleChange}
                value={usingPersonalToken ? "personal" : "oauth"}
            >
                <HStack spacing="24px">
                    <Radio value="personal">Personal Token</Radio>
                    <Radio value="oauth">One-Click Auth</Radio>
                </HStack>
            </RadioGroup>
        </HStack>
    );
}