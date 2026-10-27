import { beforeAll, describe, expect, it } from "vitest";
import { RULE_EXAMPLES } from "./rule-examples.ts";

interface Engine {
  validate(when: string): void;
}

/**
 * The gateway's own rule engine, loaded by path at run time. A plain import would pull the gateway's
 * Node-only sources into the web app's typecheck; the web app has no other tie to the gateway.
 */
const gateway = (file: string) => new URL(`../../../../packages/gateway/src/${file}`, import.meta.url).href;
let engine: Engine;

beforeAll(async () => {
  const { CelEngine } = (await import(/* @vite-ignore */ gateway("cel.ts"))) as {
    CelEngine: new (schema: unknown, neutral: unknown) => Engine;
  };
  const { CONTEXT_SCHEMA, neutralContext } = (await import(/* @vite-ignore */ gateway("context.ts"))) as {
    CONTEXT_SCHEMA: unknown;
    neutralContext: unknown;
  };
  engine = new CelEngine(CONTEXT_SCHEMA, neutralContext);
});

describe("the rule examples", () => {
  it.each(RULE_EXAMPLES.map((example) => [example.meaning, example.when]))(
    "%s is a rule the gateway accepts",
    (_meaning, when) => {
      expect(() => engine.validate(when)).not.toThrow();
    },
  );

  it("would catch an example the gateway refuses", () => {
    expect(() => engine.validate('target.host.endsWith("example.com")')).toThrow(/not supported/);
  });
});
