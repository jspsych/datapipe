import { useContext, useState } from "react";
import { VStack, HStack, Text, Button, Input, Field } from "@chakra-ui/react";
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

  // Static-token providers have no redirect flow: clicking Connect opens an
  // inline form instead of navigating away. Only one can be open at a time.
  const [tokenFormId, setTokenFormId] = useState(null);
  const [serverUrl, setServerUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [formError, setFormError] = useState(null);

  const openTokenForm = (providerId) => {
    setTokenFormId(providerId);
    setServerUrl("");
    setApiToken("");
    setFormError(null);
  };

  const closeTokenForm = () => {
    setTokenFormId(null);
    setServerUrl("");
    setApiToken("");
    setFormError(null);
  };

  // The backend rejects any server URL that is not a plain https host: no
  // http, no embedded credentials, no odd ports, no IP literals, no internal
  // hostnames. That gate exists because the server itself makes authenticated
  // requests to whatever is submitted. Translate its opaque replies into
  // something a researcher can act on rather than surfacing them verbatim.
  const messageForError = (status, error) => {
    if (error === "Invalid server URL") {
      return "That does not look like a Dataverse server address. Use the full https:// address of your institution's installation, for example https://dataverse.harvard.edu.";
    }
    if (error === "Invalid API token") {
      return "That server did not accept the token. Check that you copied it fully, that it has not expired, and that it belongs to the server above.";
    }
    if (status === 401 || status === 403) {
      return "You are not signed in to the right account. Try reloading the page and signing in again.";
    }
    return "Could not connect. Please try again.";
  };

  const handleTokenConnect = async (providerId) => {
    setConnectingId(providerId);
    setFormError(null);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/connectstatictokenprovider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          uid: user.uid,
          idToken,
          token: apiToken.trim(),
          serverUrl: serverUrl.trim(),
        }),
      });

      if (!response.ok) {
        let error;
        try {
          ({ error } = await response.json());
        } catch {
          error = null;
        }
        setFormError(messageForError(response.status, error));
        return;
      }

      closeTokenForm();
    } catch (err) {
      console.error("Failed to connect provider:", err);
      setFormError("Could not reach DataPipe. Check your connection and try again.");
    } finally {
      setConnectingId(null);
    }
  };

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
        const isStaticToken = provider.authMethod === "static-token";
        const formOpen = tokenFormId === provider.id;

        return (
          <VStack key={provider.id} w="100%" align="stretch" gap={2}>
          <HStack
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
                aria-label={`Disconnect ${provider.name}`}
                loading={disconnectingId === provider.id}
                onClick={() => handleDisconnect(provider.id)}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                colorPalette="blue"
                size="md"
                variant={formOpen ? "outline" : "solid"}
                aria-label={`${formOpen ? "Cancel" : "Connect"} ${provider.name}`}
                loading={connectingId === provider.id && !isStaticToken}
                onClick={() =>
                  isStaticToken
                    ? formOpen
                      ? closeTokenForm()
                      : openTokenForm(provider.id)
                    : handleConnect(provider.id)
                }
              >
                {formOpen ? "Cancel" : "Connect"}
              </Button>
            )}
          </HStack>

          {formOpen && !connected && (
            <VStack
              align="stretch"
              gap={3}
              w="100%"
              borderWidth="1px"
              borderRadius="md"
              p={4}
            >
              {provider.needsServerUrl && (
                <Field.Root>
                  <Field.Label>{provider.serverUrlLabel}</Field.Label>
                  <Input
                    type="url"
                    value={serverUrl}
                    placeholder={provider.serverUrlPlaceholder}
                    onChange={(e) => setServerUrl(e.target.value)}
                  />
                </Field.Root>
              )}
              <Field.Root>
                <Field.Label>{provider.tokenLabel}</Field.Label>
                <Input
                  type="password"
                  value={apiToken}
                  autoComplete="off"
                  onChange={(e) => setApiToken(e.target.value)}
                />
                {provider.tokenHelp && (
                  <Field.HelperText>{provider.tokenHelp}</Field.HelperText>
                )}
              </Field.Root>

              {formError && (
                <Text fontSize="sm" color="red.400">
                  {formError}
                </Text>
              )}

              <HStack justifyContent="flex-end">
                <Button
                  colorPalette="blue"
                  size="md"
                  aria-label={`Save ${provider.name} connection`}
                  loading={connectingId === provider.id}
                  disabled={
                    apiToken.trim().length === 0 ||
                    (provider.needsServerUrl && serverUrl.trim().length === 0)
                  }
                  onClick={() => handleTokenConnect(provider.id)}
                >
                  Save connection
                </Button>
              </HStack>
            </VStack>
          )}
          </VStack>
        );
      })}
    </VStack>
  );
}
