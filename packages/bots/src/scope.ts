/**
 * A bot's rules bind the bot's own agent and nothing else. A pack writes its conditions as if it
 * were the only agent (`tool.kind == "send"`); installed as written, that rule would refuse every
 * send for every agent, Steward's own included. `scopeToBot` puts the pack's condition inside a
 * test of the agent's id, so it only ever applies when the person talks to that bot.
 */

/** The shape of a bot id (the pack schema's `id`). Anything else could break out of the string. */
const BOT_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** The longest condition the rule store keeps. */
export const RULE_WHEN_MAX = 2000;

/**
 * `agent.id == "<id>" && (<when>)`. The pack's condition must already parse on its own: that is
 * what keeps it inside the brackets (`true) || (true` does not parse alone, but would once
 * wrapped). `validatePack` checks it before anything is installed. The closing bracket goes on its
 * own line so a `//` comment at the end of the condition cannot swallow it.
 */
export function scopeToBot(botId: string, when: string): string {
  if (!BOT_ID.test(botId) || botId.includes("--")) {
    throw new Error(`"${botId}" is not a bot id, so its rules cannot be limited to it`);
  }
  return `agent.id == "${botId}" && (${when}\n)`;
}
