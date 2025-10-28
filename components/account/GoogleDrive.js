import { useState, useContext, useEffect } from "react";
import { UserContext } from "../../lib/context";
import { useRouter } from "next/router";

import { useDisclosure } from "@chakra-ui/react";
import {
  HStack,
  VStack,
  Button,
  Text,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  FormControl,
  FormLabel,
  Input,
  Tooltip,
  Link,
  Switch,
  FormHelperText,
  Alert,
  AlertIcon,
  useToast,
} from "@chakra-ui/react";

import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc, setDoc } from "firebase/firestore";

import { db, auth } from "../../lib/firebase";
import { CheckCircleIcon, WarningIcon, ExternalLinkIcon } from "@chakra-ui/icons";

export default function GoogleDrive() {
  const { user } = useContext(UserContext);
  const router = useRouter();
  const toast = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [localGoogleDriveEnabled, setLocalGoogleDriveEnabled] = useState(false);

  const [data, loading, error, snapshot, reload] = useDocumentData(
    doc(db, "users", user.uid)
  );

  // Update local state when data changes
  useEffect(() => {
    if (data?.googleDriveEnabled !== undefined) {
      setLocalGoogleDriveEnabled(data.googleDriveEnabled);
    }
  }, [data?.googleDriveEnabled]);

  // Reset local state when modal opens
  useEffect(() => {
    if (isOpen && data?.googleDriveEnabled !== undefined) {
      setLocalGoogleDriveEnabled(data.googleDriveEnabled);
    }
  }, [isOpen, data?.googleDriveEnabled]);

  // Check for success/error messages from OAuth callback
  useEffect(() => {
    if (router.query.googleDriveSuccess) {
      // Check if we have tokens to store
      if (router.query.access_token && router.query.refresh_token && router.query.userId) {
        // Store the tokens in Firestore
        storeGoogleDriveTokens(
          router.query.access_token,
          router.query.refresh_token,
          parseInt(router.query.expires_in),
          router.query.userId
        );
      }
      
      toast({
        title: "Google Drive connected successfully!",
        status: "success",
        duration: 5000,
        isClosable: true,
      });
      // Clear the query parameter
      router.replace("/admin/account", undefined, { shallow: true });
      // Note: The useDocumentData hook will automatically refresh when the document changes
    } else if (router.query.googleDriveError) {
      toast({
        title: "Failed to connect Google Drive",
        description: "Please try again or check your configuration.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      router.replace("/admin/account", undefined, { shallow: true });
    }
  }, [router.query, toast, reload]);

  return (
    <HStack justifyContent="space-between" w="100%">
      <HStack>
        <Text fontSize={"lg"}>Google Drive Export</Text>
        {data && data.googleDriveEnabled ? (
          <Tooltip label="Google Drive export enabled">
            <CheckCircleIcon color="brandTeal.500" />
          </Tooltip>
        ) : (
          <Tooltip label="Google Drive export disabled">
            <WarningIcon color="brandOrange.500" />
          </Tooltip>
        )}
      </HStack>
      <Button isLoading={isSubmitting} onClick={onOpen} colorScheme="brandTeal">
        Configure Google Drive
      </Button>
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalOverlay />
        <ModalContent bg="greyBackground">
          <ModalHeader>Configure Google Drive Export</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} w="100%" align="stretch">
              <Alert status="info">
                <AlertIcon />
                <VStack align="start" spacing={2}>
                  <Text color="blue.800" fontWeight="medium">
                    Google Drive export is an optional alternative to OSF.
                    You can use both simultaneously for redundancy.
                  </Text>
                </VStack>
              </Alert>
              
              <FormControl display="flex" alignItems="center">
                <FormLabel htmlFor="google-drive-enabled" mb="0" color="gray.700" fontWeight="medium">
                  Enable Google Drive Export
                </FormLabel>
                <Switch 
                  id="google-drive-enabled" 
                  isChecked={localGoogleDriveEnabled}
                  onChange={(e) => {
                    setLocalGoogleDriveEnabled(e.target.checked);
                    if (!e.target.checked) {
                      // If disabling, clear the folder ID
                      handleSaveGoogleDrive(false, "");
                    }
                  }}
                />
              </FormControl>

              {!data?.googleDriveRefreshToken && (
                <Alert status="warning">
                  <AlertIcon />
                  <VStack align="start" spacing={3}>
                    <Text color="orange.800" fontWeight="medium">
                      You need to connect your Google Drive account first.
                    </Text>
                    <Button
                      size="md"
                      colorScheme="blue"
                      onClick={() => connectGoogleDrive()}
                      minW="fit-content"
                    >
                      Connect Google Drive
                    </Button>
                  </VStack>
                </Alert>
              )}

              {data?.googleDriveRefreshToken && (
                <Alert status="success">
                  <AlertIcon />
                  <Text color="green.800" fontWeight="medium">
                    Google Drive account connected successfully!
                  </Text>
                </Alert>
              )}

              {localGoogleDriveEnabled && (
                <>
                  <FormControl id="google-drive-folder">
                    <FormLabel color="gray.700" fontWeight="medium">Google Drive Folder ID</FormLabel>
                    <Input 
                      type="text" 
                      placeholder="Enter folder ID from Google Drive URL"
                      defaultValue={data?.googleDriveFolderId || ""}
                    />
                    <FormHelperText color="gray.600">
                      To get the folder ID: 1) Go to Google Drive, 2) Navigate to or create a folder, 
                      3) Copy the ID from the URL (the long string after /folders/)
                    </FormHelperText>
                  </FormControl>
                  
                  <Text fontSize="sm">
                    <Link 
                      color="brandOrange.500" 
                      href="https://drive.google.com" 
                      isExternal
                      _hover={{ textDecoration: "underline" }}
                    >
                      Open Google Drive <ExternalLinkIcon mx="2px" />
                    </Link>
                  </Text>
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant={"outline"}
              mr={3}
              onClick={() => {
                setLocalGoogleDriveEnabled(data?.googleDriveEnabled || false);
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              variant={"solid"}
              colorScheme={"brandTeal"}
              size={"md"}
              mr={4}
              onClick={() => {
                const folderId = document.querySelector("#google-drive-folder")?.value || "";
                handleSaveGoogleDrive(localGoogleDriveEnabled, folderId);
                onClose();
              }}
              isLoading={isSubmitting}
            >
              Save Configuration
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </HStack>
  );

  async function handleSaveGoogleDrive(enabled, folderId) {
    try {
      console.log("Starting handleSaveGoogleDrive...");
      console.log("User UID:", auth.currentUser.uid);
      console.log("Enabled:", enabled);
      console.log("Folder ID:", folderId);
      
      const userDoc = doc(db, "users", auth.currentUser.uid);
      console.log("Document reference created:", userDoc.path);
      
      const dataToWrite = { 
        uid: auth.currentUser.uid,
        googleDriveEnabled: enabled, 
        googleDriveFolderId: enabled ? folderId : "" 
      };
      console.log("Data to write:", dataToWrite);
      
      console.log("Attempting to write to Firestore...");
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Save operation timed out after 15 seconds')), 15000);
      });
      
      const setDocPromise = setDoc(userDoc, dataToWrite, { merge: true });
      await Promise.race([setDocPromise, timeoutPromise]);
      
      console.log("Firestore write successful!");
      
      // Show success message and reload data
      toast({
        title: "Google Drive configuration saved successfully!",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
      
      // Reload the user data to reflect changes
      if (reload) {
        reload();
      }
      
    } catch (error) {
      console.error("Error in handleSaveGoogleDrive:", error);
      console.error("Error details:", {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      
      // Show error message
      toast({
        title: "Failed to save Google Drive configuration",
        description: error.message,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      
      throw error;
    }
  }

  async function connectGoogleDrive() {
    try {
      // Generate the OAuth URL with the user ID as state
      const authUrl = `/api/google-drive-auth?userId=${auth.currentUser.uid}`;
      window.location.href = authUrl;
    } catch (error) {
      console.error("Failed to initiate Google Drive connection:", error);
    }
  }

  async function storeGoogleDriveTokens(accessToken, refreshToken, expiresIn, userId) {
    try {
      console.log("Starting storeGoogleDriveTokens...");
      console.log("User ID:", userId);
      console.log("Access token length:", accessToken?.length || 0);
      console.log("Refresh token length:", refreshToken?.length || 0);
      console.log("Expires in:", expiresIn);
      
      const userDoc = doc(db, "users", userId);
      console.log("Document reference created:", userDoc.path);
      
      // Try using a different approach - write data in smaller chunks
      console.log("Attempting to write tokens to Firestore using chunked approach...");
      
      try {
        // Write tokens one by one to avoid overwhelming the emulator
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Token storage timed out after 15 seconds')), 15000);
        });
        
        // First, write just the refresh token
        console.log("Writing refresh token...");
        const refreshTokenPromise = setDoc(userDoc, { 
          uid: userId,
          googleDriveRefreshToken: refreshToken 
        }, { merge: true });
        await Promise.race([refreshTokenPromise, timeoutPromise]);
        console.log("Refresh token written successfully");
        
        // Then write the access token
        console.log("Writing access token...");
        const accessTokenPromise = setDoc(userDoc, { 
          uid: userId,
          googleDriveAccessToken: accessToken 
        }, { merge: true });
        await Promise.race([accessTokenPromise, timeoutPromise]);
        console.log("Access token written successfully");
        
        // Finally write the expiry
        console.log("Writing token expiry...");
        const expiryPromise = setDoc(userDoc, { 
          uid: userId,
          googleDriveTokenExpiry: new Date(Date.now() + expiresIn * 1000) 
        }, { merge: true });
        await Promise.race([expiryPromise, timeoutPromise]);
        console.log("Token expiry written successfully");
        
      } catch (error) {
        console.error("Chunked write failed:", error);
        throw error;
      }
      
      console.log("Google Drive tokens stored successfully!");
      
    } catch (error) {
      console.error("Failed to store Google Drive tokens:", error);
      console.error("Error details:", {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}
