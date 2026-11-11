/**
 * Keeps one failure from ending every run and stream at once.
 *
 * - A promise nothing waited for (a relay event, a background check) is logged, and Steward keeps
 *   serving. Node's default is to exit on the spot, mid-run, with no stream closed and no run stored.
 * - An exception nothing caught leaves the process in a state nobody knows, so it is logged and
 *   Steward closes the way it does on Ctrl-C (`stop`), then exits with an error.
 *
 * Only the message is logged, never the error's other fields, which can carry what a tool returned.
 */
export function guardProcess(
  target: Pick<NodeJS.Process, "on">,
  stop: (why: string) => void,
  log: (line: string) => void = (line) => console.error(line),
): void {
  target.on("unhandledRejection", (reason: unknown) => {
    log(`[steward] something in the background failed: ${messageOf(reason)}`);
  });
  target.on("uncaughtException", (err: unknown) => {
    log(`[steward] stopping after an unexpected error: ${messageOf(err)}`);
    stop("error");
  });
}

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name;
  return typeof reason === "string" ? reason : "no message";
}
