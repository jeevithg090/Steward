// The routine frame is adapted from OpenDuet shared/routine-firing.ts (MIT, CopilotKit).
import type { Task } from "@steward/shared";

/**
 * Turns nobody typed (a routine firing, a task starting) are sent as a user message that starts
 * with a fixed frame, so the model knows what kind of turn it is and the web app can draw a quiet
 * line instead of a bubble the person never wrote. Frames must stay readable forever: stored turns
 * are matched on them. Change one only by adding a new frame and keeping the old one in `FRAMES`.
 */
export const ROUTINE_FRAME =
  "One of your routines is firing right now, on its schedule, and this is that firing. " +
  "Carry out the instruction below in this turn: do the work now, then say what happened. " +
  "Do not create, list or change any routine unless the instruction itself asks you to.";

export const TASK_FRAME =
  "The person started this task from their Tasks page. Do the work in this conversation now, " +
  "then say in a sentence or two what you did and what is left.";

export const FRAMES = [ROUTINE_FRAME, TASK_FRAME] as const;

export function routineFiring(prompt: string): string {
  return `${ROUTINE_FRAME}\n\n${prompt.trim()}`;
}

export function taskStart(task: Pick<Task, "title" | "detail" | "nextStep">, note?: string): string {
  const parts = [TASK_FRAME, `Task: ${task.title.trim()}`];
  if (task.detail.trim()) parts.push(task.detail.trim());
  if (task.nextStep?.trim()) parts.push(`First step: ${task.nextStep.trim()}`);
  if (note?.trim()) parts.push(`From the person: ${note.trim()}`);
  return parts.join("\n\n");
}

/** The words after a frame, or the text itself when it has none. */
export function unframe(text: string): { frame?: (typeof FRAMES)[number]; body: string } {
  for (const frame of FRAMES) {
    if (text.startsWith(frame)) return { frame, body: text.slice(frame.length).trim() };
  }
  return { body: text };
}
