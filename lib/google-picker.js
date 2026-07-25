// Encapsulates all Google Picker / gapi interaction so that React
// components stay thin and the Google-specific browser API surface is
// isolated to a single module. No secrets live here -- the apiKey/appId
// are passed in by the caller (sourced from env vars).

const PICKER_SCRIPT_SRC = "https://apis.google.com/js/api.js";

let gapiLoadPromise = null;
let pickerLoadPromise = null;

function loadGapiScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Picker is only available in the browser"));
  }

  if (window.gapi) {
    return Promise.resolve(window.gapi);
  }

  if (gapiLoadPromise) {
    return gapiLoadPromise;
  }

  gapiLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(
      `script[src="${PICKER_SCRIPT_SRC}"]`
    );

    const handleLoad = () => {
      if (window.gapi) {
        resolve(window.gapi);
      } else {
        reject(new Error("Failed to load Google API script"));
      }
    };

    if (existingScript) {
      // Script tag is already present (e.g. injected by a previous call
      // that hasn't finished loading yet) -- just wait for it.
      existingScript.addEventListener("load", handleLoad);
      existingScript.addEventListener("error", () =>
        reject(new Error("Failed to load Google API script"))
      );
      return;
    }

    const script = document.createElement("script");
    script.src = PICKER_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", handleLoad);
    script.addEventListener("error", () =>
      reject(new Error("Failed to load Google API script"))
    );
    document.body.appendChild(script);
  });

  return gapiLoadPromise;
}

function loadPicker() {
  if (pickerLoadPromise) {
    return pickerLoadPromise;
  }

  pickerLoadPromise = loadGapiScript().then(
    (gapi) =>
      new Promise((resolve, reject) => {
        if (gapi.picker) {
          resolve(gapi);
          return;
        }
        gapi.load("picker", {
          callback: () => resolve(gapi),
          onerror: () => reject(new Error("Failed to load Google Picker API")),
        });
      })
  );

  return pickerLoadPromise;
}

/**
 * Opens the Google Picker configured for selecting a single Drive folder.
 *
 * @param {Object} options
 * @param {string} options.accessToken - short-lived drive.file OAuth token
 * @param {string} options.apiKey - Google API developer key
 * @param {string} options.appId - Google Cloud project number, ties the
 *   drive.file grant to our app so the folder is writable server-side later
 * @returns {Promise<{id: string, name: string} | null>} resolves with the
 *   chosen folder's id/name, or null if the user cancelled the picker.
 */
export async function pickDriveFolder({ accessToken, apiKey, appId }) {
  await loadPicker();
  const google = window.google;

  if (!google || !google.picker) {
    throw new Error("Google Picker failed to initialize");
  }

  return new Promise((resolve, reject) => {
    try {
      // A DOCS view rooted at My Drive (setParent "root") gives a navigable
      // folder tree with a breadcrumb path -- unlike ViewId.FOLDERS, which
      // renders every folder in one flat list with no hierarchy. Restricting
      // mimeTypes to folders keeps files out, so the user only sees and picks
      // folders while still drilling down through the tree.
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setParent("root")
        .setMimeTypes("application/vnd.google-apps.folder")
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true);

      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs && data.docs[0];
            if (doc) {
              resolve({ id: doc.id, name: doc.name });
            } else {
              resolve(null);
            }
          } else if (data.action === google.picker.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (err) {
      reject(err);
    }
  });
}
