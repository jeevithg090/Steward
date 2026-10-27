/**
 * The examples the rule form offers to start from. The gateway's CEL has no string methods, so
 * `endsWith` and friends are written as functions: `endsWith(target.host, "example.com")`. A test
 * runs each one through the gateway's own engine.
 */
export const RULE_EXAMPLES: { when: string; meaning: string }[] = [
  { when: 'tool.surface == "calendar"', meaning: "Anything touching your calendar" },
  {
    when: 'tool.name == "browser_navigate" && endsWith(target.host, "example.com")',
    meaning: "Opening pages on one site",
  },
  {
    when: 'tool.kind == "send" && target.recipients.all(r, endsWith(r, "@mycompany.com"))',
    meaning: "Emails only to your own company",
  },
  { when: 'initiator.kind == "routine" && tool.kind != "read"', meaning: "A routine changing anything" },
];
