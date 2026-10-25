# Kairos Guardian: Threats and Defence

Research note for the Kairos (Tempo) team, OxHack 2026. Written Sunday 25 October 2026. Supports the Guardian: the local vault, the blue-team watcher agents, and the behaviour baseline.

Marker key: ✅ checked against a primary source we opened. ⚠️ secondary source, or we could not open the primary. ❌ could not verify. Numbers in square brackets point to the Sources list at the end.

## Summary: the five findings that most change the design

1. The money is in "authorised" fraud, where the victim presses the button themselves. UK APP fraud was £450.7m across under 186,000 cases in 2024 [1]. Kairos must add friction to the person's own payments, not just block strangers.
2. The deadliest scams for older people are investment and "tech support" (remote access), not parcel texts. US over-60s lost $1.83bn to investment fraud and $982m to tech-support fraud in 2024 [6]. A newly installed remote-access app is the single strongest signal we can watch for.
3. Scams run on time pressure and secrecy. 64% of scams are over within a day of first contact ⚠️ [10]. "Don't tell anyone" is part of the script. So the best defences are slow and social: cooling-off, call back on a known number, and a trusted contact.
4. Generic warnings get clicked through (70.2% for Chrome SSL warnings in 2013), but well-designed, specific, active warnings get heeded [31][32]. Kairos warnings must be rare, concrete and must interrupt the flow.
5. An agent that reads untrusted text (letters, texts, web pages) and can also move money is the "lethal trifecta" [37]. The letter-reading agent and the bank-driving agent must be different agents, with the person's confirmation as the only bridge. Everything the agents do must land in a hash-chained log that the watchers can audit.

## 1. How ordinary people get scammed on their phones

### 1.1 Headline numbers (2024 to 2025)

| Measure | Figure | Year | Mark | Source |
|---|---|---|---|---|
| UK total fraud losses (authorised + unauthorised) | £1.17bn, broadly flat on 2023 | 2024 | ✅ | [1] |
| UK unauthorised fraud (cards, remote banking) | 3.13m cases (+14%), £722m (+2%); over 98% refunded | 2024 | ✅ | [1] |
| UK APP (authorised push payment) fraud | £450.7m (−2%), under 186,000 cases (−20%), lowest since 2020 | 2024 | ✅ | [1] |
| UK APP money reimbursed by banks | £267.1m, about 59% of APP losses | 2024 | ✅ | [1] |
| UK APP reimbursed under new PSR rules | 86% of in-scope money returned in the first three months | Oct to Dec 2024 | ✅ | [1] |
| Where UK APP scams start | 70% of cases online (29% of losses); 16% of cases via telecoms | 2024 | ✅ | [1][5] |
| UK H1 2025 total | £629.3m stolen, 2.09m cases (+17%) | Jan to Jun 2025 | ✅ | [2] |
| UK H1 2025 APP | £257.5m, up 12%, driven by investment fraud | Jan to Jun 2025 | ⚠️ | [3] |
| Suspicious texts, UK mobile users | 50% got a suspicious text or iMessage in Nov 2024 to Feb 2025 | 2025 | ✅ | [4] |
| Suspicious calls, UK phone users | 42% received one in the last 3 months; 51% of mobile users got a suspicious message; 32% weekly | Feb 2025 | ✅ | [5] |
| Suspicious messages reported to 7726 | about 100 million in the year to April 2025; 600m+ blocked a year | 2025 | ✅ | [4] |
| US internet crime (FBI IC3) | 859,532 complaints, $16.6bn losses (+33%) | 2024 | ✅ | [6] |
| US over-60s (FBI IC3) | 147,127 complaints, $4.8bn losses; the largest age group by loss | 2024 | ✅ | [6] |
| Global (GASA) | 46,000 adults in 42 markets: 57% encountered a scam, 23% lost money | 2025 | ✅ | [9] |
| Global losses (GASA/Feedzai estimate) | about $442bn across 42 countries | 2025 | ⚠️ | [10] |

### 1.2 The scam types, in the order the person meets them

| Scam | How it looks to the victim | First contact | Typical loss and scale | Mark | Source |
|---|---|---|---|---|---|
| "Hi Mum / Hi Dad" | A message from an unknown number: "I've broken my phone, this is my new number, I need to pay a bill urgently." Often moves from SMS to WhatsApp. Now with AI voice notes. | SMS or WhatsApp from a new number | Action Fraud: 1,235 reports, £1.5m lost, Feb to Jun 2022. FOI: £226,744 lost to the text version 2023 to 2025. Santander: "son" is the most successful persona. UK banks say victims usually lose up to about £3,000. | ⚠️ | [11][12] |
| Courier / parcel text (smishing) | "Your parcel could not be delivered, pay a small fee." Link to a copycat site that takes card and personal details. Often followed days later by a "bank fraud team" call using those details. | SMS, iMessage | Parcel texts were 67.4% of smishing reports over 30 days and 53.2% over 90 days (to July 2021); bank texts were next. Delivery-fee loss is small; the follow-up "safe account" call is the big loss. | ✅ | [13] |
| Bank or police impersonation ("safe account") | A call, often from a spoofed bank number: "Your account is compromised, move your money to a safe account now." Caller may already know card details from an earlier phishing text. | Phone call, sometimes after a text | UK Finance: losses −16% and cases −32% in 2024 (no absolute figure in the press release). Still one of the highest loss-per-case types. | ✅ | [1] |
| Courier fraud (police impersonation, cash handover) | "Police officer" says the person's cards are compromised; a "courier" collects cards, cash or gold from the home. Aimed squarely at older people. | Landline call | City of London Police: 1,891 reports in 2025 (1,721 the year before), more than £21m lost. | ⚠️ | [14] |
| Tech support / remote access | Pop-up "virus" warning, or a call from "BT", "Microsoft" or "your bank". Victim installs AnyDesk, TeamViewer or similar. Screen is blurred while the criminal moves money. | Pop-up or cold call | Action Fraud: 20,144 victims, £57.8m, average £2,868 (2021 data, published 2022). US over-60s: $982m lost to tech-support fraud in 2024, the second largest category. | ⚠️/✅ | [15][6] |
| One-time passcode (OTP) relay | Caller says "we need to stop a fraudulent payment, read me the code we just sent you." The code actually authorises the criminal's payment or a new device. | Phone call during a live attack | HSBC: fraudsters ask for the OTP "to stop the transaction"; the bank never asks for OTPs. No reliable UK loss total for this tactic alone. | ✅ | [16] |
| QR code "quishing" | Sticker over a car-park payment QR code, or a QR code in an email to "verify your account". Leads to a fake payment page. | Physical sticker, email | Action Fraud via Which?: £3.5m lost in 2024; 784 reports Apr 2024 to Apr 2025. Most common in car parks. | ⚠️ | [17] |
| Subscription traps | Free trial or cheap offer rolls into a paid plan that is hard to cancel. Not a crime, but a steady drain on people who do not check statements. | Online sign-up | DBT: nearly 10m of 155m UK subscriptions unwanted, costing £1.6bn a year (Nov 2024). New rules under the DMCC Act 2024 include a 14-day cooling-off after auto-renewal. | ✅ | [18] |
| SIM swap | Phone loses signal; the number has been ported to a criminal's SIM, who now receives the bank's codes. | Preceded by phishing or data breach | Cifas: nearly 3,000 cases in 2024, up 1,055%; over-61s are 29% of all account takeover cases. US over-60s: 205 complaints, $6.3m. | ✅ | [19][6] |
| Fake HMRC / DVLA / NHS messages | "You are owed a tax refund" or "your vehicle tax payment failed", with a link. Also threatening voicemails about arrest. | SMS, email, voicemail | HMRC: 170,000+ scam referrals in the 12 months to 31 July 2025, 47,000+ about fake refunds. DVLA warnings via police (Jan 2025). No verified NHS-specific loss figure found. | ✅/⚠️/❌ | [20][21] |
| Investment and crypto | Social media advert or a "friend" introduces a trading platform. Fake dashboards show profits. Withdrawals need "fees". | Social media, messaging apps, after a romance contact | UK Finance: £144.4m lost in 2024 (+34%), the largest APP category by value. US over-60s: $1.83bn lost; 33,369 over-60 complaints involved cryptocurrency. | ✅ | [1][6] |
| Romance | Months of daily messages, then a crisis needing money, or an "investment" tip. Victim hides the relationship from family. | Dating apps, social media | Action Fraud: 9,096 reports, £99.4m in 2024 (UK Finance bank data show far less: £36.5m in 2023, because many never tell their bank). US over-60s: $389m in 2024. FCA review: in nearly half of 60 cases the victim lied to the bank about the payment reason. | ⚠️/✅ | [22][6][23] |

### 1.3 Who gets hit

| Finding | Mark | Source |
|---|---|---|
| Over-60s are the largest US age group by complaints (147,127) and losses ($4.8bn) in 2024 [6]. | ✅ | [6] |
| Over-60 US losses in 2023 were about $3.4bn from about 101,000 complaints, so 2024 is a steep rise. | ⚠️ | [7] |
| Age UK (2015): 53% of over-65s believed they had been targeted; 60% of those never reported it. | ✅ | [24] |
| Ofcom (2021): 61% of people aged 75+ had received a suspected scam call on their landline. | ⚠️ | [25] |
| Cifas: filings for account takeover against the over-61s rose 90% in 2024. | ✅ | [19] |
| Which? on romance fraud 2024: most reports were men aged 20 to 29, then women aged 50 to 59. Older is not the only risk group. | ⚠️ | [22] |
| GASA 2025: victims skew younger and educated worldwide; low-GDP countries are hit hardest per person. | ⚠️ | [10] |

### 1.4 What the numbers mean for Kairos

- Our users are hit twice: by volume (texts, calls) and by value (investment, remote access, safe account). The classifier handles volume; the Guardian handles value.
- Phone calls are the bridge between a cheap text and a large loss. A payment attempted during or just after an unknown call is the pattern to catch.
- Victims lie to their bank under the scammer's instruction (FCA: nearly half of cases) [23]. A yes/no "are you being pressured?" prompt is weak. Behavioural signals are stronger than questions.
- Under-reporting is large (Age UK 60%; romance victims ashamed) [24][22]. The Guardian should record near-misses locally so the person can see patterns without having to admit anything to anyone.

## 2. The psychology: why people comply

### 2.1 Stajano and Wilson, seven principles (CACM 2011, tech report 2009) ✅ [26][27]

| Principle | What it says | How Kairos should respond |
|---|---|---|
| Distraction | While attention is held elsewhere, the fraudster acts unnoticed. | Never stack a payment confirmation on top of another task. One screen, one decision. |
| Social compliance | People defer to authority and lower their guard. | Treat "bank", "police", "HMRC" in a call or text as a risk word, not a reassurance. |
| Herd | People relax when others seem to face the same risk. | Watch for "everyone is doing this", fake testimonials, group chats pushing an investment. |
| Dishonesty | A small wrong step is later used against the victim. | Expect secrecy. Never shame; make it easy to say "I think I made a mistake". |
| Deception | Appearances mislead; fake objects and people look genuine. | Confirmation of Payee mismatch, number spoofing checks, and "is this really your son's number?" |
| Need and greed | Once a fraudster knows what you want, you are easy to steer. | Baseline the person's known needs (a visa, a refund, a partner) and treat offers that match them as higher risk. |
| Time | Under pressure, people switch to fast, low-reasoning decisions. | Slow the system down: cooling-off, "sleep on it", scheduled rather than instant payments. |

### 2.2 Cialdini's principles of persuasion, as scammers use them ✅ [28]

| Principle | Scam use |
|---|---|
| Reciprocity | "I've already refunded you £50, now help me." Ebner's work finds reciprocity-based phishing works better on older adults ✅ [30]. |
| Scarcity | "The offer closes tonight", "last slot", "before the account is frozen". |
| Authority | Spoofed bank numbers, police badge numbers, HMRC letter templates. |
| Consistency | Small first steps (a £1 fee) commit the person to the story. |
| Liking | Romance, "Hi Mum", the friendly tech-support agent. |
| Social proof | Fake reviews, fake group chats, "your neighbour also had this problem". |
| Unity | "We are both from the same community", used heavily on newcomers to the UK. |

### 2.3 Other research we lean on

| Work | Finding | Mark | Source |
|---|---|---|---|
| Modic and Lea (2013), scam compliance | Four reliable factors: influence of authority, social influence, need for consistency, self-control. Lack of self-control was the strongest predictor in the original studies. | ⚠️ | [29] |
| Modic, Anderson and Palomäki (2018), StP-II scale | 10 subscales; social influence had the largest effect on finding a scam plausible (n = 6,609). | ✅ | [29] |
| Whitty (2013), Scammers Persuasive Techniques Model | 20 victim interviews. Grooming comes before any money request; the "near-win" effect keeps victims in and explains re-victimisation. Stages (from a systematic review): ideal profile, grooming, the sting, sexual abuse, revelation; later version adds motivation and re-victimisation. | ✅ / stages ⚠️ | [33][34] |
| Lichtenberg et al. (2013), Clinical Gerontologist | 4,440 older adults. Those with high depression and low social-needs fulfilment had a 226% higher fraud prevalence. | ⚠️ | [35] |
| Ebner and Pehlivanoglu (2024), University of Florida | Lower memory and slower processing raise phishing susceptibility; loneliness and low digital literacy raise it further; financially exploited older adults had a smaller insula ("gut feeling" region). | ✅ | [30] |
| FCA romance fraud review (Oct 2025) | 6 firms, 60 cases, £100 to £428,249. Nearly half of victims hid the true reason for payment. 15% were repeat victims at the same firm. One family member's report sat unactioned for 18 months, ending in a £121,000 loss. | ✅ | [23] |

### 2.4 The four levers: time, isolation, authority, cognitive load

- Time: every script creates a deadline. Stajano's "time principle" and GASA's "64% over within a day" ⚠️ [10] agree. Delay is the cheapest defence.
- Isolation: "Don't tell anyone, they are in on it", "keep this between us". Romance victims lie to their bank [23]. A defence that only talks to the victim loses; a defence that reaches a trusted person wins.
- Authority: spoofed numbers and official-looking letters. Ofcom now makes providers block calls from abroad spoofing UK numbers and is consulting on fake sender names [4][5].
- Cognitive load: a stressed person on a phone call with a pop-up on screen cannot evaluate a warning. Interrupt the call, not just the screen.

### 2.5 What friction actually works

| Intervention | Evidence | Mark | Source | Lesson for Kairos |
|---|---|---|---|---|
| Confirmation of Payee (name check before paying) | 2 billion checks by March 2024, 1.9m a day, 100+ organisations, 350+ more mandated in 2024. Pay.UK credits it with reducing misdirected payments and fraud. | ✅ | [36] | Treat a "no match" as a hard stop, not a warning. |
| Delaying suspicious payments | Payment Services (Amendment) Regulations 2024, in force 30 Oct 2024: banks may hold an outbound payment up to 4 business days where there are reasonable grounds to suspect fraud (FCA FG24/6). | ✅ | [38] | A 24-hour hold on first payments to a new payee is legal, normal and expected. |
| Deferring high-risk payments for a human conversation | FCA found firms that held high-risk payments and required the customer to speak to a staff member did better; staff who challenged implausible stories stopped losses. | ✅ | [23] | A voice conversation beats a tap-through warning. Kairos can be that voice. |
| Banking Protocol (branch staff call police) | £282.3m prevented and 1,298 arrests since 2016, as of mid-2023; £60.7m in 2021 from 10,072 calls. FCA notes it fails when the victim stays under the scammer's influence. No 2024 figure found. | ⚠️ / ❌ | [39][23] | Escalation to a human works, but only if someone the person trusts is involved. |
| Mandatory APP reimbursement (PSR) | From 7 Oct 2024, up to £85,000 per claim, covering over 99% of claims; 86% of in-scope money returned in the first three months. Secondary sources: £100 excess (not for vulnerable customers), 5 business days, costs split 50/50 between sending and receiving bank. | ✅ / details ⚠️ | [40][1][41] | Reimbursement exists, but only for UK bank-to-bank payments. Card, crypto and international payments are not covered. Prevention still matters. |
| 159: hang up and call your bank | Over one million calls since launch; covers more than 99% of UK current accounts. | ✅ | [42] | Kairos should offer "call 159" or "call the number on your card" as the default reaction to any bank call. |
| Singapore Money Lock | Launched Nov 2023; 61,000+ accounts and S$5.4bn locked by Feb 2024; locked funds cannot be moved digitally; no fraud incidents on locked funds. Self-service "kill switch" to freeze an account since Oct 2022. | ✅ | [43][44] | Offer a "locked pot" idea: savings that Kairos and the phone cannot move at all. |
| Australia Scams Prevention Framework Act 2025 | Assented 20 Feb 2025, commenced 21 Feb 2025. Six principles: governance, prevent, detect, report, disrupt, respond. Banks, telcos and digital platforms to be designated. Penalties up to 159,745 penalty units (reported as about A$50m). | ✅ / A$ ⚠️ | [45][46] | Detect, disrupt and respond is a good frame for the Guardian's watcher roles. |
| Japan ATM limits for older customers | National Police Agency considering a ¥300,000 daily ATM withdrawal and transfer cap for people 75+; Osaka ordinance of ¥100,000 for 70+ with no recent transfers. Special fraud losses ¥72.1bn in 2024, 45% of 20,951 victims aged 75+. | ⚠️ | [47] | Age-based limits are blunt. Baseline-based limits (what this person normally does) are kinder and more accurate. |
| Trusted contact approval (Monzo, 2024) | Known Locations, Trusted Contacts (a chosen person approves large transfers, may be asked to video call), Secret QR Codes; opt-in above a daily limit. Call Status shows if the bank is really calling. | ⚠️ | [48] | A trusted contact is a live UK product, not a theory. Kairos can do it across any bank. |
| Take Five: Stop, Challenge, Protect | Official UK campaign checks include "asked to move money to a new or safe account", "asked to share a one-time passcode, password or PIN", and "use contact details you found yourself". | ✅ | [49] | Our teaching messages should reuse this wording so it matches what the bank says. |

### 2.6 Warning design: why generic warnings fail

| Study | Finding | Mark | Source |
|---|---|---|---|
| Egelman, Cranor and Hong (2008), "You've been warned" | Lab study, 60 people: 97% fell for at least one phishing email; 79% heeded an active (interrupting) warning; only about 13% heeded a passive one. | ⚠️ | [31] |
| Akhawe and Felt (2013), "Alice in Warningland" | 25 million real warnings. Click-through: Firefox malware/phishing about 10%, Chrome malware/phishing about 25%, Firefox SSL about 33%, Chrome SSL 70.2%. Design, not users, explains the gap. | ✅ | [32] |

Design rules that follow: interrupt (do not overlay); say exactly what is wrong in one sentence; make the safe choice the default button; make warnings rare so they are not habituated; offer a concrete next step ("call 159 now").

## 3. Securing AI agents that act for the person

### 3.1 OWASP Top 10 for LLM Applications 2025 (published Nov 2024) ✅ [50]

| Code | Risk | Where it bites Kairos |
|---|---|---|
| LLM01 | Prompt Injection | Letters, texts, notifications and web pages contain text aimed at the agent. |
| LLM02 | Sensitive Information Disclosure | The vault holds habits, payees and relationships. Agents must see the minimum. |
| LLM03 | Supply Chain | Models, packages, prompts and the Gemini API are all dependencies. |
| LLM04 | Data and Model Poisoning | A scammer could feed the baseline with "normal" behaviour before the attack. |
| LLM05 | Improper Output Handling | Agent output drives the phone. Validate before acting. |
| LLM06 | Excessive Agency | The bank-driving agent must not also be able to read email or install apps. |
| LLM07 | System Prompt Leakage | Our rules ("never say safe") must not be the only control. |
| LLM08 | Vector and Embedding Weaknesses | If we embed letters for search, injected text can surface later. |
| LLM09 | Misinformation | A confident wrong reading of a letter can cause a real payment. |
| LLM10 | Unbounded Consumption | Runaway loops burn money and hide in noise. Budget every agent run. |

### 3.2 Prompt injection: the three framings we use

| Framing | Statement | Mark | Source |
|---|---|---|---|
| Willison, "lethal trifecta" (16 Jun 2025) | Danger when one agent has access to private data, exposure to untrusted content, and the ability to communicate externally. Advice: avoid the combination entirely. | ✅ | [37] |
| Willison, "Dual LLM pattern" (25 Apr 2023) | A privileged LLM with tools never sees untrusted text; a quarantined LLM with no tools reads it; a plain-software controller passes results as opaque variables. Willison himself calls it imperfect; CaMeL later fixed a flaw. | ✅ | [51] |
| Meta, "Agents Rule of Two" (31 Oct 2025) | An agent should satisfy no more than two of: [A] processes untrustworthy inputs, [B] has access to sensitive systems or private data, [C] can change state or communicate externally. If all three are needed, add human-in-the-loop. | ✅ | [52] |

Kairos mapping: the letter reader is [A]+[B] (reads letters, knows who the person is) and must have no state-changing tools. The bank driver is [B]+[C] and must only receive structured, validated instructions plus the person's Face ID. Nothing is [A]+[B]+[C].

### 3.3 Six design patterns (Beurer-Kellner et al., June 2025) ✅ [53]

Core principle, quoted: once an agent has ingested untrusted input, "it must be constrained so that it is impossible for that input to trigger any consequential actions."

| Pattern | One line | Kairos use |
|---|---|---|
| Action-Selector | The agent picks one of a fixed set of actions and gets no feedback from them. | Voice commands map to a fixed menu ("pay electricity bill", "read letter"). |
| Plan-Then-Execute | The plan is fixed before any untrusted data is read; tool outputs cannot change which actions run. | Bill payment: plan = read amount, check payee, confirm, pay. Letter content cannot add steps. |
| LLM Map-Reduce | Isolated LLM calls each process one untrusted item with constrained outputs; a separate step combines them. | Each letter or text is read in isolation and returns a fixed schema (sender, amount, deadline, risk words). |
| Dual LLM | Privileged planner never sees raw untrusted text; quarantined reader does. | The agent that drives the bank app never sees the letter; it sees "amount: £84.20, payee: Thames Water (CoP match)". |
| Code-Then-Execute | The agent writes a small program that calls tools and quarantined readers, then that program runs. | The hub generates a checkable plan the watchers can review before execution. |
| Context-Minimization | Remove the user's prompt or untrusted content from context once it has done its job. | After extracting fields from a letter, drop the letter text before any action step. |

### 3.4 Benchmarks and sobering results

| Work | Finding | Mark | Source |
|---|---|---|---|
| AgentDojo (Debenedetti et al., 2024) | 97 realistic tasks (email, e-banking, travel) and 629 security test cases. State-of-the-art LLMs fail many tasks even without attack; existing attacks break some but not all security properties. | ✅ | [54] |
| CaMeL (Debenedetti et al., Google DeepMind, 2025) | Wraps the LLM in a system layer that extracts control and data flow from the trusted query and enforces capabilities on tool calls. Solves 77% of AgentDojo tasks with provable security, against 84% undefended. | ✅ | [55] |
| "The Attacker Moves Second" (2025) | Adaptive attacks bypassed 12 published prompt-injection and jailbreak defences, most above 90% success; human red teams reached 100%. | ⚠️ | [56] |

Takeaway: do not rely on a detector. Rely on architecture (what the agent cannot do) plus the person's confirmation.

### 3.5 Watching the watchers: second-model monitoring and diversity

| Work | Finding | Mark | Source | Kairos use |
|---|---|---|---|---|
| AI Control (Greenblatt et al., 2023) | A weaker trusted model (GPT-3.5) checks a stronger untrusted one (GPT-4). "Trusted editing" and "untrusted monitoring" with anti-collusion beat simple baselines. | ✅ | [57] | The local small model on the hub is the trusted monitor for the Gemini agents. |
| Baker et al., OpenAI (Mar 2025) | A weaker model (GPT-4o) can monitor a stronger one (o3-mini). Monitoring the chain of thought beats monitoring actions alone. Warning: training against the monitor teaches obfuscation; accept a "monitorability tax". | ✅ | [58] | Log the agent's reasoning and plan, not just its tool calls. Never fine-tune agents on watcher verdicts. |
| Constitutional Classifiers, Anthropic (Feb 2025) | Separate input and output classifiers cut jailbreak success from 86% to 4.4%, with +0.38% false refusals and +23.7% compute. | ✅ | [59] | A cheap classifier in front of and behind each agent is affordable. |
| N-version programming (Avizienis 1985; Knight and Leveson 1986) | Independent versions voted together. Knight and Leveson: 27 versions, one million tests; failures were far from independent. | ⚠️ | [60][61] | Two different model families reviewing the same payment helps, but shared blind spots remain. Add a rule-based check that does not use a model at all. |

### 3.6 Tamper-evident logging for the hub's event log

| Technique | What it gives | Mark | Source |
|---|---|---|---|
| Schneier and Kelsey (1999), secure audit logs | Entries written before a compromise stay unreadable to the attacker and cannot be altered or deleted undetectably; a cheap scheme using hash chaining and an evolving key. | ✅ | [62] |
| Crosby and Wallach (2009), history trees | Tree-based tamper-evident log with logarithmic-size proofs; an untrusted logger can be audited by clients. | ✅ / detail ⚠️ | [63] |
| RFC 6962 Certificate Transparency (2013) | An append-only Merkle tree with signed tree heads; inclusion proofs show an entry is present, consistency proofs show nothing was changed or removed. | ✅ | [64] |

Design: every agent action, watcher verdict and user confirmation becomes a log entry; each entry includes the hash of the previous one; the phone periodically stores the latest root hash in the Keychain so the hub cannot rewrite history without the phone noticing.

### 3.7 Honeytokens and canaries

| Idea | Detail | Mark | Source |
|---|---|---|---|
| Honeytokens (Spitzner, 2003) | "Everything a honeypot is, except not a computer": a fake record, card number or login whose only use is illicit. Term coined by Augusto Paes de Barros, 2003. | ⚠️ | [65] |
| Canarytokens (Thinkst) | Free decoys ("motion sensors" for your data): fake AWS keys, documents, QR codes, DNS names, MCP configuration files, that alert when touched. | ✅ | [66] |

Kairos use: plant a fake payee ("Aunt Margaret, sort code...") and a fake "PIN note" in the vault. Any agent, prompt or process that reads or uses them has been hijacked. Alert and freeze.

### 3.8 Vault cryptography

| Technique | What it is | Mark | Source | Kairos use |
|---|---|---|---|---|
| Envelope encryption and key hierarchy (AWS KMS docs) | Data is encrypted with a data key; the data key is encrypted with a higher key that never leaves protected hardware. Rotating the top key does not mean re-encrypting all data. | ✅ | [67] | One master key in the Secure Enclave; one data key per record class (payees, habits, people). |
| NIST SP 800-57 Part 1 Rev 5 (May 2020) | Key management guidance: key types, protection each type needs, cryptoperiods, split knowledge. | ✅ | [68] | Follow its key-type separation; never use one key for everything. |
| Crypto-shredding / cryptographic erase (NIST SP 800-88 Rev 2, Sept 2025) | Destroying the key renders the data infeasible to recover. Listed as a sanitisation method. | ✅ / definition ⚠️ | [69] | "Delete everything about me" = destroy the data key. Instant, provable, works on backups too. |
| Blind indexes (Paragon Initiative, 2017) | Store an HMAC of the plaintext (with a separate key) beside the ciphertext to allow exact-match search without decrypting. Limits: exact match only, duplicate leakage, weak for low-entropy fields. | ✅ | [70] | Look up "is this sort code a known payee?" without decrypting the payee list. |

### 3.9 Least privilege and capability tokens

| Work | Finding | Mark | Source | Kairos use |
|---|---|---|---|---|
| Macaroons (Birgisson et al., NDSS 2014) | Bearer tokens with chained HMAC caveats; a holder can only narrow (attenuate) a token: time window, requester, purpose. | ✅ | [71] | Each agent run gets a token: "pay up to £90 to payee X before 14:05, after Face ID". The bank driver cannot widen it. |

### 3.10 iOS platform security

| Feature | Detail | Mark | Source | Kairos use |
|---|---|---|---|---|
| Keychain data protection classes | WhenUnlocked, AfterFirstUnlock, Always, WhenPasscodeSetThisDeviceOnly. "ThisDeviceOnly" items are never restored to another device; WhenPasscodeSet items are not synced, not backed up, and are destroyed if the passcode is removed. | ✅ | [72] | Vault root key: WhenPasscodeSetThisDeviceOnly. Pairing secret with the hub: AfterFirstUnlock ThisDeviceOnly. |
| Secure Enclave | Isolated from the main processor; hardware keys in the AES Engine and Public Key Accelerator cannot be read even by its own OS; passcode-protected data is erased after the attempt limit (10 on iPhone). | ✅ | [73] | Signing agent plans and log roots with a Secure Enclave key proves the phone, not the hub, approved them. |

### 3.11 Local-first: why the data stays on the person's devices

Kleppmann, Wiggins, van Hardenberg and McGranaghan (Ink and Switch, April 2019) ✅ [74]: seven ideals, including works offline, data survives the vendor, privacy by default, and "you own your data, in spite of the cloud". For Kairos this means: the vault and event log live on the person's phone and hub; Gemini sees only the minimum extracted fields for a task, never the vault; nothing in the design needs a Kairos server to exist for the person's data to keep working.

## 4. Rights over personal data

UK GDPR principles and rights, as the ICO states them ✅ [75][76]:

| Principle or right | One line | What Kairos does |
|---|---|---|
| Lawfulness, fairness, transparency | Process legally, fairly and openly. | The person can hear, in plain words, what the Guardian has learned about them. |
| Purpose limitation | Collect for stated purposes; do not reuse incompatibly. | Behaviour baseline is for fraud friction only. Never for advertising, never for scoring the person. |
| Data minimisation | Adequate, relevant, limited to what is needed. | Store "usually pays Thames Water on the 3rd" not every transaction detail. |
| Accuracy | Keep correct and up to date. | The person can correct a payee's name or a routine by voice. |
| Storage limitation | Keep identifiable data no longer than needed. | Raw letters and call metadata expire; only extracted facts persist. |
| Integrity and confidentiality | Protect against unauthorised access, loss or damage. | Encrypted vault, hash-chained log, Secure Enclave keys. |
| Accountability | Be able to show compliance. | The log is the evidence. |
| Right of access and portability | Get your data and reuse it elsewhere. | Export the vault as plain JSON on request. |
| Right to erasure | Have personal data erased. | Crypto-shred the data key. Gone everywhere at once, including backups. |

"The person owns the data" in practice means: it is on their hardware; they hold the key; they can read it in plain words; they can take it away in an open format; they can destroy it in one step; and no one else, including us, can see it without them knowing.

## 5. Defence chain for Kairos

| Scam | Hook used | Observable signal on phone or hub | Friction Kairos adds | Plain-words teaching message |
|---|---|---|---|---|
| Hi Mum / Hi Dad | Liking, time, need | Message from a number not in the vault claiming to be a known person; urgency words ("urgent", "today", "new number"); payment attempt to a new payee within an hour | Block the payee until a call to the person's known number succeeds; offer "call them now" in one tap | "Someone says they are your son on a new number. Before you send money, we will ring his old number together." |
| Courier / parcel text | Authority, need, distraction | Link to a domain not matching the courier; request for a card number; followed by an incoming call within days | Classifier flags the text; Guardian marks the card as "exposed" and raises friction on any bank call for 14 days | "Real couriers do not ask for fees by text. If a 'bank' calls this week, hang up and ring 159." |
| Bank or police "safe account" | Social compliance, time, deception | Incoming call (any number) in the last 30 minutes plus a transfer to a brand-new payee, especially to a personal account; words "safe", "secure", "move your money" | Hard stop. No transfer to a new payee during or within 30 minutes after a call. Offer "hang up and call 159" | "Your bank will never ask you to move money to a safe account. Hang up. Ring 159 from your own phone." |
| Courier fraud (cash handover) | Authority, dishonesty ("help us catch the bank staff") | Unusual cash withdrawal pattern; "police" call; request for card PIN | Guardian never reads a PIN aloud and never enters one; large cash withdrawal triggers a trusted-contact message | "Police never collect cards or cash from your home. If someone says they will, it is a scam." |
| Tech support / remote access | Authority, distraction, time | AnyDesk, TeamViewer or similar newly installed; screen sharing active; bank app opened while a call is live | Freeze all payments while a remote-access app is installed or a screen share is active; ask to uninstall first | "A real company never needs to control your phone to fix it. Let's remove that app, then talk." |
| OTP relay | Authority, time | OTP text arrives while a call is in progress; agent asked to read a code aloud | Refuse to read any one-time code aloud during a call; show it only on screen; never enter codes on a caller's instruction | "Codes are for you alone. Nobody from a bank will ever ask you to read one out." |
| Quishing | Deception, distraction | Camera scanned a QR code leading to a payment page on an unknown domain | Open QR links in a sandboxed preview that shows the real domain and blocks card entry until the person confirms | "Scan, but do not pay yet. We check where that code really goes first." |
| Subscription traps | Consistency, distraction | Recurring small charge not in the baseline; "free trial" email 7 days ago | Monthly "what are you paying for" review by voice; one-tap cancel letter | "You are paying £9.99 a month for something you have not used. Want me to cancel it?" |
| SIM swap | Deception | Loss of signal while on Wi-Fi; "SIM changed" or "new device" notifications; bank login from a new device | Freeze payments until the person confirms on Face ID; alert trusted contact; advise calling the network from another phone | "Your phone lost its number. That can be a scam. We have paused payments until you say it is fine." |
| Fake HMRC / DVLA / NHS | Authority, need, time | Letter or text with a link or phone number not on gov.uk; "refund", "arrest", "penalty" words | Letter reader marks it suspicious and never dials or opens the number inside; offers the official gov.uk route instead | "HMRC never texts about refunds. If you want to check, we will go to gov.uk together." |
| Investment and crypto | Need and greed, herd, scarcity | Payments to a trading platform or crypto exchange that is not in the baseline; rising amounts over weeks; new app installed; messages promising returns | 24-hour cooling-off on first payment; trusted-contact message on second; show FCA register check result | "Nobody can promise profits. We will wait a day and check the firm is on the FCA register." |
| Romance | Liking, need, isolation | Daily messaging with one new contact; payments to a person never met; secrecy signals ("do not tell"); video calls declined | Cooling-off plus "would you like to tell someone you trust before this goes?" prompt; never judgemental | "You have sent money to someone you have not met in person. We can ask someone you trust to look with you." |

Signals that raise the baseline score across all rows: new payee, amount above the person's usual, evening or night, payment during or within 30 minutes of a call, urgency words, new app installed today, screen share active, CoP mismatch or "no match", first ever international payment.

### What we deliberately do not do

- Never ask for, store, speak or type a PIN, password or one-time code.
- Never say the word "safe" about a payment or an account.
- Never act on instructions found inside a letter, text, email, notification or web page. Those are data to be read, never commands to be run.
- Never let the agent that reads untrusted text also hold a tool that moves money, installs apps or sends messages.
- Never approve a payment without the person's on-screen "Yes" and Face ID, and never auto-fill that confirmation.
- Never shame. The Guardian records near-misses privately so the person can review them without telling anyone.
- Never send the vault off the device. Gemini sees extracted fields for one task, not the person's history.
- Never let the hub alone rewrite history. Log roots are countersigned by the phone's Secure Enclave key.
- Never trust a phone number or sender name shown on screen. Known numbers come from the vault, not from the message.
- Never fine-tune agents against watcher verdicts (the monitorability tax, Baker et al. 2025).

## Sources

1. ✅ UK Finance, Annual Fraud Report 2025 press release (27 May 2025). https://www.ukfinance.org.uk/news-and-insight/press-release/fraud-report-2025-press-release
2. ✅ UK Finance, Half Year Fraud Report 2025. https://www.ukfinance.org.uk/policy-and-guidance/reports-and-publications/half-year-fraud-report-2025
3. ⚠️ BioCatch summary of UK Finance H1 2025 APP figures. https://www.biocatch.com/blog/uk-finances-half-year-fraud-report-2025-the-continuing-evolution-of-fraud
4. ✅ Ofcom, New rules to protect people and businesses against mobile messaging scams (29 Oct 2025). https://www.ofcom.org.uk/phones-and-broadband/scam-calls-and-messages/new-rules-to-protect-people-and--businesses-against-mobile-messaging-scams
5. ✅ Ofcom, Combating Scam Calls: An Ofcom Perspective, NICC Open Forum (12 Nov 2025), citing Ofcom 2025 "Experiences of suspicious calls, texts and app messages". https://niccstandards.org.uk/wp-content/uploads/2025/11/08-NICC-Open-Forum-2025-Combating-Scam-calls-Ofcom.pdf
6. ✅ FBI IC3, 2024 Internet Crime Report (text extracted from the PDF). https://ic3.gov/AnnualReport/Reports/2024_IC3Report.pdf
7. ⚠️ AARP summary of the FBI 2024 report and 2023 comparison. https://www.aarp.org/money/scams-fraud/fbi-report-fraud-2024.html
8. ⚠️ GASA, Global State of Scams Report 2024 (press coverage). https://www.accessnewswire.com/newsroom/en/government/global-losses-to-scammers-exceed-1-trillion-as-1-in-4-lose-money-to-fraudsters-791331
9. ✅ GASA, Global scams on the rise: over half of adults worldwide report scam encounters, 23% lost money (Oct 2025). https://gasa.org/knowledge-base/blog/global-scams-on-the-rise-over-half-of-adults-worldwide-report-scam-encounters
10. ⚠️ Feedzai, 5 key takeaways from the GASA Global State of Scams 2025 report (9 Oct 2025). https://www.feedzai.com/blog/gasa-global-state-of-scams-report/
11. ⚠️ Which?, Notorious "Hi Mum and Dad" scam spreads from WhatsApp to text message (7 Sept 2022), citing Action Fraud. https://www.which.co.uk/news/article/notorious-hi-mum-and-dad-scam-spreads-from-whatsapp-to-text-message-an7N34c0gVbP
12. ⚠️ The Independent via AOL, WhatsApp scam known as "hi mum" evolving at breakneck speed (5 May 2025), Action Fraud FOI and Santander. https://www.aol.com/news/whatsapp-scam-known-hi-mum-140520615.html
13. ✅ Take Five / UK Finance, Fake parcel delivery texts are the top smishing scam (16 Aug 2021), Proofpoint data. https://www.takefive-stopfraud.org.uk/news/fake-parcel-delivery-texts-are-the-top-smishing-scam/
14. ⚠️ City of London Police courier fraud alert (2025) as republished by Easton on the Hill parish site. https://eastononthehill.com/village-life/Police-Messages/Entries/2025/7/courier-fraud-alert.html
15. ⚠️ Action Fraud remote access scam figures (7 Apr 2022) as reported by Cornish Times. https://www.cornish-times.co.uk/news/action-fraud-warns-ps50m-was-lost-last-year-through-computer-remote-access-scams-543686
16. ✅ HSBC UK, What is two-factor authentication (one-time passcode guidance). https://www.hsbc.co.uk/help/security-centre/what-is-two-factor-authentication/
17. ⚠️ Which?, Quishing scams warning (25 Jun 2025), citing Action Fraud. https://www.which.co.uk/news/article/quishing-scams-warning-how-to-spot-and-avoid-dodgy-qr-codes-asYsH0h6jjP1
18. ✅ GOV.UK (DBT), New measures unveiled to crack down on subscription traps (18 Nov 2024). https://www.gov.uk/government/news/new-measures-unveiled-to-crack-down-on-subscription-traps
19. ✅ Cifas, 1,055% surge in unauthorised SIM swaps (7 May 2025). https://www.cifas.org.uk/newsroom/huge-surge-see-sim-swaps-hit-telco-and-mobile
20. ✅ HMRC press release, Scams warning as Self Assessment customers targeted (20 Aug 2025). https://www.mynewsdesk.com/uk/hm-revenue-customs-hmrc/pressreleases/scams-warning-as-self-assessment-customers-targeted-3400182
21. ⚠️ Thames Valley Police alert on fake DVLA emails (Jan 2025), via Weston-on-the-Green parish council. https://westononthegreen-pc.gov.uk/news/thames-valley-police-alert-information/
22. ⚠️ Which?, Romance fraud hit £99.4m in 2024 (13 Feb 2025), Action Fraud and UK Finance data. https://www.which.co.uk/news/article/romance-fraud-hit-99.4m-in-2024-here-are-7-signs-youre-dating-a-scammer-avu9z2G7yuCh
23. ✅ FCA, Combating romance fraud: prevention, detection and supporting victims (17 Oct 2025). https://www.fca.org.uk/publications/multi-firm-reviews/combating-romance-fraud-prevention-detection-and-supporting-victims
24. ✅ Age UK, Over half of people aged 65+ targeted by fraudsters (8 Apr 2015). https://www.ageuk.org.uk/latest-press/over-half-of-people-aged-65-targeted-by-fraudsters/
25. ⚠️ Ofcom, 45 million people targeted by scams (2021 survey). https://www.ofcom.org.uk/phones-and-broadband/scam-calls-and-messages/45-million-people-targeted-by-scams
26. ✅ Stajano and Wilson, Understanding scam victims: seven principles for systems security, Cambridge tech report UCAM-CL-TR-754 (2009); CACM 54(3) 70-75 (2011). https://www.cl.cam.ac.uk/techreports/UCAM-CL-TR-754.html
27. ✅ Stajano, Understanding the psychology of scam victims (principles page). https://www.cl.cam.ac.uk/~fms27/scams/
28. ✅ Cialdini / Influence at Work, The 7 principles of persuasion. https://www.influenceatwork.com/7-principles-of-persuasion/
29. ✅ Modic, Anderson and Palomäki, We will make you like our research: the development of a susceptibility-to-persuasion scale, PLoS ONE 13(3) 2018 (also summarises Modic and Lea 2013). https://pmc.ncbi.nlm.nih.gov/articles/PMC5854354
30. ✅ Ebner and Pehlivanoglu, Are older adults more vulnerable to scams? University of Florida News (11 Jun 2024). https://news.ufl.edu/2024/06/older-adults-vulnerable-to-scams/
31. ⚠️ Egelman, Cranor and Hong, You've been warned: an empirical study of the effectiveness of web browser phishing warnings, CHI 2008. https://css.csail.mit.edu/6.566/2018/readings/youve-been-warned.pdf
32. ✅ Akhawe and Felt, Alice in Warningland, USENIX Security 2013. https://research.google/pubs/pub41323/
33. ✅ Whitty, The Scammers Persuasive Techniques Model, British Journal of Criminology 53(4) 665-684 (2013), abstract via OJP. https://www.ojp.gov/ncjrs/virtual-library/abstracts/scammers-persuasive-techniques-model-development-stage-model
34. ⚠️ Tainted Love: a systematic review of online romance fraud (arXiv 2303.00070), for Whitty's stage names. https://arxiv.org/pdf/2303.00070
35. ⚠️ Lichtenberg et al., Is psychological vulnerability related to the experience of fraud in older adults? Clinical Gerontologist 2013, via ScienceDaily (26 Apr 2013). https://sciencedaily.com/releases/2013/04/130425132441.htm
36. ✅ Pay.UK, Confirmation of Payee reaches two billion checks (Mar 2024). https://newseventsinsights.wearepay.uk/media-centre/press-releases/confirmation-of-payee-reaches-two-billion-checks-helping-protect-uk-consumers-against-fraud/
37. ✅ Willison, The lethal trifecta for AI agents (16 Jun 2025). https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
38. ✅ FCA, FG24/6 Guidance for firms that enables a risk-based approach to payments (22 Nov 2024). https://www.fca.org.uk/publications/finalised-guidance/fg24-6-guidance-firms-enables-risk-based-approach-payments
39. ⚠️ UK Finance, 2023 Half Year Fraud Update (Banking Protocol cumulative figures). https://www.ukfinance.org.uk/system/files/2023-10/Half%20year%20fraud%20update%202023.pdf
40. ✅ PSR, PSR confirms its decision on APP scams reimbursement (25 Sept 2024). https://psr.org.uk/news-and-updates/latest-news/news/psr-confirms-its-decision-on-app-scams-reimbursement
41. ⚠️ Bird and Bird, New UK APP fraud rules: latest developments (excess, timing, standard of caution). https://www.twobirds.com/en/insights/2024/uk/new-uk-app-fraud-rules-latest-developments
42. ✅ Stop Scams UK, 159. https://stopscamsuk.org.uk/159
43. ✅ MAS, Oral reply to Parliamentary Question on Money Lock (29 Feb 2024). https://www.mas.gov.sg/news/parliamentary-replies/2024/oral-reply-to-parliamentary-question-on-money-lock
44. ✅ Singapore MDDI, Measures to protect Singaporeans against online scams (kill switch, Money Lock). https://www.mddi.gov.sg/newsroom/measures-to-protect-singaporeans-against-online-scams/
45. ✅ Scams Prevention Framework Act 2025 (Cth), No. 15, 2025, legislation.gov.au. https://legislation.gov.au/C2025A00015/asmade/2025-02-20/text/original/epub/OEBPS/document_1/document_1.html
46. ⚠️ Gilbert + Tobin, The Scams Prevention Framework legislation passes Parliament (A$50m penalties). https://www.gtlaw.com.au/insights/the-scams-prevention-framework-legislation-passes-parliament-time-to-get-your-house-in-order
47. ⚠️ Nippon.com / Jiji, Japan eyes 300,000-yen limit on daily ATM use for elderly (25 Mar 2025); SCMP coverage of NPA proposal. https://www.nippon.com/en/news/yjj2025032500550 and https://scmp.com/week-asia/economics/article/3304007/japan-police-propose-atm-curbs-elderly-combat-fraud
48. ⚠️ Which?, Monzo unveils three fraud-fighting tools (2024). https://www.which.co.uk/news/article/monzo-unveils-three-fraud-fighting-tools-apcKC2k65mSl
49. ✅ Take Five, General advice: Stop, Challenge, Protect. https://www.takefive-stopfraud.org.uk/advice/general-advice/
50. ✅ OWASP GenAI Security Project, Top 10 for LLM Applications 2025. https://genai.owasp.org/llm-top-10/
51. ✅ Willison, The Dual LLM pattern for building AI assistants that can resist prompt injection (25 Apr 2023). https://simonwillison.net/2023/Apr/25/dual-llm-pattern/
52. ✅ Meta, Agents Rule of Two: a practical approach to AI agent security (31 Oct 2025). https://ai.meta.com/blog/practical-ai-agent-security/
53. ✅ Beurer-Kellner et al., Design Patterns for Securing LLM Agents against Prompt Injections, arXiv 2506.08837 (Jun 2025). https://arxiv.org/abs/2506.08837
54. ✅ Debenedetti et al., AgentDojo, arXiv 2406.13352 (2024). https://arxiv.org/abs/2406.13352
55. ✅ Debenedetti et al., Defeating Prompt Injections by Design (CaMeL), arXiv 2503.18813 (2025). https://arxiv.org/abs/2503.18813
56. ⚠️ Willison, New prompt injection papers: Agents Rule of Two and The Attacker Moves Second (2 Nov 2025). https://simonwillison.net/2025/Nov/2/new-prompt-injection-papers/
57. ✅ Greenblatt, Shlegeris, Sachan and Roger, AI Control: Improving Safety Despite Intentional Subversion, arXiv 2312.06942. https://arxiv.org/abs/2312.06942
58. ✅ Baker et al. (OpenAI), Monitoring Reasoning Models for Misbehavior and the Risks of Promoting Obfuscation, arXiv 2503.11926 (14 Mar 2025). https://arxiv.org/abs/2503.11926
59. ✅ Anthropic, Constitutional Classifiers (3 Feb 2025). https://www.anthropic.com/research/constitutional-classifiers
60. ⚠️ Wikipedia, N-version programming (Avizienis 1985). https://en.wikipedia.org/wiki/N-version_programming
61. ⚠️ Knight and Leveson, An experimental evaluation of the assumption of independence in multiversion programming, IEEE TSE 12(1) 1986. https://libraopen.lib.virginia.edu/public_view/jd472w463
62. ✅ Schneier and Kelsey, Secure Audit Logs to Support Computer Forensics, ACM TISSEC 1(3) 159-176 (1999). https://www.schneier.com/academic/archives/1999/05/secure_audit_logs_to.html
63. ✅ Crosby and Wallach, Efficient Data Structures for Tamper-Evident Logging, USENIX Security 2009 (slides for detail ⚠️). https://www.usenix.org/conference/usenixsecurity09/technical-sessions/presentation/efficient-data-structures-tamper-evident and https://static.usenix.org/events/sec09/tech/slides/crosby.pdf
64. ✅ Laurie, Langley and Kasper, RFC 6962 Certificate Transparency (Jun 2013). https://datatracker.ietf.org/doc/html/rfc6962
65. ⚠️ Spitzner, Honeytokens: The Other Honeypot (SecurityFocus, 17 Jul 2003), republished by Symantec. https://www.symantec.com/connect/articles/honeytokens-other-honeypot
66. ✅ Thinkst, Canarytokens guide. https://docs.canarytokens.org/guide/
67. ✅ AWS KMS Developer Guide, Concepts (key hierarchy, data keys, envelope encryption). https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html
68. ✅ NIST SP 800-57 Part 1 Rev 5, Recommendation for Key Management (May 2020). https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final
69. ✅ NIST SP 800-88 Rev 2, Guidelines for Media Sanitization (Sept 2025). https://csrc.nist.gov/pubs/sp/800/88/r2/final
70. ✅ Paragon Initiative, Building searchable encrypted databases with PHP and SQL (blind indexes), 25 May 2017. https://paragonie.com/blog/2017/05/building-searchable-encrypted-databases-with-php-and-sql
71. ✅ Birgisson et al., Macaroons: Cookies with Contextual Caveats, NDSS 2014. https://research.google/pubs/pub41892/
72. ✅ Apple Platform Security, Keychain data protection. https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web
73. ✅ Apple Platform Security, Secure Enclave. https://support.apple.com/guide/security/secure-enclave-sec59b0b31ff/web
74. ✅ Kleppmann et al., Local-first software (Ink and Switch, Apr 2019). https://www.inkandswitch.com/essay/local-first/
75. ✅ ICO, A guide to the data protection principles. https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/
76. ✅ ICO, Individual rights. https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/

Gaps we could not close today (❌): a 2024 or 2025 Banking Protocol figure; UK Finance's absolute 2024 figures for safe-account impersonation and romance (only the percentage changes are in the press release); any verified NHS-specific scam-text loss figure; a UK loss figure for OTP relay as a tactic on its own.
