# Kairos on iPhone: what the user asked for (acceptance checklist)

Collected on Sun 25 Oct 2026, 01:30–03:20 GMT, from the user's own words. The final merge and review check every
line against the built app. Each line is marked ✅ (works, proven on the phone), 🟡 (built, not yet proven on the
phone) or ❌ (missing).

| # | Requirement (user's words in quotes) | Where it lives | Proof needed |
|---|---|---|---|
| 1 | Agents run **on the iPhone itself** ("run the agents on the iphone itself") | `TempoApp/Agents/Core/KairosAgent.swift` (Swift orchestrator in the app) | Works with the Mac switched off |
| 2 | The agents' brain is **Gemini via the user's API key** | `Core/ModelProvider.swift` (GeminiProvider, key in the iPhone Keychain) | Smoke test ✅ on the Mac (02:50); on the phone after the key is pasted |
| 3 | Voice is **Siri or ElevenLabs**, and ElevenLabs is wired to the agents | Siri: `Siri/AgentIntents.swift` (Ask Kairos). ElevenLabs: `phone_agent` client tool → `TempoSession.clientTool` → KairosAgent | "Hey Siri, ask Kairos …" answers; in a Talk call, "set an alarm for 7" runs on the phone |
| 4 | It **automates the iPhone** for people with little tech knowledge, and guides them | Helpers: Planner, People, Letter, Scam Shield, Money, Everyday | Big-text UI; plain spoken answers; how-to steps |
| 5 | "**Create a shortcut for X**" saves it, and next time "**do X**" follows the saved automation | Routines (`RoutinesAgent`, `RoutineStore`, `RunRoutineIntent`) | Make one, then replay it with no model call; it shows up as a Siri phrase |
| 6 | Agents **take control of the phone like on a laptop**, and **fast** ("each decision taking lot of time … connect with Gemini") | Phone operator via iCTRL on 127.0.0.1:8200 (`Operator/*`, `Hands/ICTRLHands.swift`); the Mac `phone/phone_agent.py` on Gemini | ≤1.5 s per decision; drives WhatsApp |
| 7 | **Pre-designed agents + custom agents** made from the user's request, with **saved setups** | Agent Studio (`Studio/*`, `StudioUI/*`): 12 built-in agents, create_agent, export/import JSON | Make an agent from one sentence; it is still there after a restart |
| 8 | **Owner-based** permissions: "caps on banks", social media allowed "as long as they agree" | `Trust/OwnerPolicy.swift` + Permissions screen | Banking is always locked; after the owner grants Instagram, a post goes through with no card |
| 9 | "**Take a pic and upload** somewhere", which Siri and normal agents can't do | `Media/PhotoAgent.swift` + the operator's photo skills | Photo → WhatsApp or Instagram, end to end |
| 10 | **Self-presentation**: it introduces itself, **deploys agents that work in the background while ElevenLabs explains** what is happening, then "ask me something and I'll do it" | Present mode (`Showcase/*`, `ShowcaseUI/*`): the agent's action and the narration run **at the same time**, with live progress spoken | A full rehearsal in ≤3½ min with no hang; the handover to the judges works |
| 11 | Open source, in a **separate GitHub repo** pushed after completion | `ShivaTeja05/kairos-ios` (private for now) | Repo exists; no secrets in it |
| 12 | Something the user can **test on their iPhone as soon as possible** | v1 install after build 1, v2 after the final merge | Installed and opens on the 12 Pro Max |

Constraints the user accepted: messages and calls end with the person's own tap (iOS rule); money never moves
automatically; iCTRL needs Developer Mode and a start from the Mac; the free Apple ID means 7-day re-signing.
