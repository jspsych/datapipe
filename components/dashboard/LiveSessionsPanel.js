import { useEffect, useState } from "react";
import { Box, Table, Text } from "@chakra-ui/react";
import SectionPanel from "./SectionPanel";
import StatusIndicator from "../ui/StatusIndicator";

// Participants part-way through a streaming experiment, updating live.
//
// The rows come from liveSessions/{id} (functions/src/live-sessions.ts), which
// the server keeps in step with the staging tier: a row appears the moment a
// participant's session starts, its state changes within seconds of a dropout
// or a reconnect, and it disappears when the session finishes or is recovered.
// The page subscribes with the same Firestore listener pattern as everything
// else on it, so there is no polling here.
//
// What each row shows was decided deliberately: how long the session has been
// running, and its connection state. Not the participant's filename (often a
// panel ID), not their last activity, not their trial count.

// A lecture-hall study can have a few hundred sessions at once. Past this the
// table stops earning its space (PRODUCT.md principle 4) and a count says the
// rest.
export const MAX_ROWS = 25;

// Durations are shown to the minute, so ticking every 15 seconds is never more
// than a quarter-minute behind -- and one interval for the whole table, not
// one per row.
export const TICK_MS = 15_000;

/** Firestore Timestamp, epoch millis, or a serialized {seconds} -> millis. */
function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}

/** "under a minute", "4 min", "1 h 12 min", "3 h". */
export function formatElapsed(ms) {
  if (!(ms >= 60_000)) return "under a minute";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * What a row's status says, given the clock.
 *
 * "Being recovered" is decided HERE, from the server-written `recoverAfter`,
 * rather than waiting for another write: the moment the grace period runs out
 * is known in advance, so the row can change on its own. The server's own
 * grace constant never has to be copied into the browser.
 */
export function displayState(row, now) {
  if (row.state === "disconnected") {
    const recoverAfter = toMillis(row.recoverAfter);
    if (recoverAfter !== null && now >= recoverAfter) {
      return { status: "neutral", label: "Stopped — being recovered" };
    }
    return { status: "warning", label: "Connection lost — may resume" };
  }
  return { status: "ok", label: "In progress" };
}

function formatStarted(ms, now) {
  const started = new Date(ms);
  const sameDay = started.toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(
    undefined,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { weekday: "short", hour: "numeric", minute: "2-digit" }
  ).format(started);
}

/**
 * @param {Array<{id: string, state: string, startedAt: any, recoverAfter?: any}>} sessions
 */
export default function LiveSessionsPanel({ sessions }) {
  const [now, setNow] = useState(() => Date.now());

  const rows = (Array.isArray(sessions) ? sessions : [])
    .map((session) => ({ ...session, startedMs: toMillis(session.startedAt) }))
    .filter((session) => session.startedMs !== null)
    // Longest-running first: the rows a researcher is most likely checking on.
    .sort((a, b) => a.startedMs - b.startedMs);
  const hasRows = rows.length > 0;

  // The clock runs only while there is something for it to move. An empty
  // panel renders nothing, and a timer ticking behind nothing would be a
  // wake-up every 15 seconds on every dashboard for no visible effect. (The
  // page also mounts this only when there are rows, so `now` starts fresh.)
  useEffect(() => {
    if (!hasRows) return undefined;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [hasRows]);

  if (!hasRows) return null;

  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <SectionPanel>
      <Text fontWeight="semibold" mb={1}>
        Sessions in progress
      </Text>
      <Text fontSize="sm" color="fg.muted" mb={4} maxW="70ch">
        Participants who have started and not yet finished. This updates as
        they start, finish, or lose their connection. A lost connection
        becomes a recovered partial file if the participant does not come
        back within 10 minutes.
      </Text>
      <Box
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        overflowX="auto"
      >
        <Table.Root variant="line" size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader>Running for</Table.ColumnHeader>
              <Table.ColumnHeader>Started</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {shown.map((row) => {
              const { status, label } = displayState(row, now);
              return (
                <Table.Row key={row.id}>
                  <Table.Cell>
                    <StatusIndicator status={status} label={label} />
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontSize="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatElapsed(now - row.startedMs)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text fontSize="xs" color="fg.muted">
                      {formatStarted(row.startedMs, now)}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      </Box>
      {hidden > 0 && (
        <Text fontSize="sm" color="fg.muted" mt={3}>
          {hidden === 1 ? "1 more session is" : `${hidden} more sessions are`} in
          progress and not shown.
        </Text>
      )}
    </SectionPanel>
  );
}
