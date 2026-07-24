import { useContext, useState } from "react";
import { VStack, HStack, Text, Button } from "@chakra-ui/react";
import { doc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { UserContext } from "../../lib/context";
import { STORAGE_PROVIDERS } from "../../lib/provider-config";

import { CircleCheck } from "lucide-react";

export default function ProviderConnections() {
  const { user } = useContext(UserContext);

  const [data] = useDocumentData(doc(db, "users", user.uid));

  const [connectingId, setConnectingId] = useState(null);
  const [disconnectingId, setDisconnectingId] = useState(null);

  const handleConnect = async (providerId) => {
    setConnectingId(providerId);
    try {
      const stateRes = await fetch("/api/generateoauthstate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      if (!stateRes.ok) throw new Error("Failed to generate state");
      const { state, authorizeUrl } = await stateRes.json();

      localStorage.setItem("latestCSRFToken", state);
      localStorage.setItem("providerConnectFlow", providerId);

      window.location.assign(authorizeUrl);
    } catch (err) {
      console.error("Failed to initiate provider connect:", err);
    } finally {
      setConnectingId(null);
    }
  };

  const handleDisconnect = async (providerId) => {
    setDisconnectingId(providerId);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/disconnectprovider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          uid: user.uid,
          idToken,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to disconnect provider");
      }
    } catch (err) {
      console.error("Failed to disconnect provider:", err);
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <VStack gap={3} w="100%" align="stretch">
      {Object.values(STORAGE_PROVIDERS).map((provider) => {
        const connected = provider.isConnected(data);

        return (
          <HStack
            key={provider.id}
            justifyContent="space-between"
            w="100%"
            flexWrap="wrap"
            gap={3}
          >
            <HStack>
              <Text fontSize="lg">{provider.name}</Text>
              {connected && (
                <HStack gap={1}>
                  <CircleCheck color="var(--chakra-colors-green-500)" size={18} />
                  <Text fontSize="sm" color="gray.400">
                    Connected
                  </Text>
                </HStack>
              )}
            </HStack>
            {connected ? (
              <Button
                colorPalette="red"
                variant="outline"
                size="md"
                loading={disconnectingId === provider.id}
                onClick={() => handleDisconnect(provider.id)}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                colorPalette="blue"
                size="md"
                loading={connectingId === provider.id}
                onClick={() => handleConnect(provider.id)}
              >
                Connect
              </Button>
            )}
          </HStack>
        );
      })}
    </VStack>
  );
}
