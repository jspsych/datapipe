// Sent on outbound calls that use Node's built-in fetch. Its default
// User-Agent is the bare string "node", which zenodo.org's firewall rejects
// with an HTML 403 ("unusual traffic from your network") before the request
// reaches the API. sandbox.zenodo.org does not, so this only shows up in
// production. node-fetch's default ("node-fetch") is not blocked.
export const DATAPIPE_USER_AGENT = "DataPipe (+https://pipe.jspsych.org)";
