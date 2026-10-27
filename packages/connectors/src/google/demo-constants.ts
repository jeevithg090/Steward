/** The demo inbox's own address. No name: Steward never calls the person by a name they did not give. */
export const DEMO_ACCOUNT = "you@demo.steward.local";

/** The demo calendar's zone. Every "today" in the demo data is today in London. */
export const DEMO_TIME_ZONE = "Europe/London";

/** The user label every demo message carries, so demo mail can never pass for real mail. */
export const DEMO_LABEL = { id: "Label_demo", name: "Demo" } as const;
