# Triage eval results

Run 2026-10-27T20:30:05.826Z on 62 labelled messages (27 need you, 35 can wait).
Written by `pnpm eval:triage`; see `README.md` beside this file for what the numbers mean.

Rules only, as asked (`--rules-only`).

| Mode                 | Model | Precision (needs you) | Recall (needs you) | F2    | Accuracy | Decided by rules (wrong) | By model | Unsorted |
| -------------------- | ----- | --------------------- | ------------------ | ----- | -------- | ------------------------ | -------- | -------- |
| Rules only, no model | none  | 54.0% (27 of 50)      | 100.0% (27 of 27)  | 85.4% | 62.9%    | 12 (0)                   | 0        | 50       |

## Rules only, no model

### Disagreements

- **c02** “Your receipt from Adobe”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A receipt for something already paid on autopay.”
- **c03** “Your October bill is ready”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A utility bill on autopay, due in two weeks.”
- **c04** “Your order has shipped”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A shipping update for supplies arriving Monday; nothing to do.”
- **c06** “Quick question about Marlow's SEO”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A cold sales pitch.”
- **c10** “Updated price list (no action needed)”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “Your assistant says no action is needed.”
- **c11** “The mugs are beautiful!”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A happy customer; a reply would be nice but nothing is at stake.”
- **c12** “Weekly digest: 12 new posts”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A community digest.”
- **c13** “Your October statement is ready”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A bank statement is ready; nothing to act on.”
- **c16** “You received a payment of $1,200.00”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A payment you received; nothing to do.”
- **c17** “Care instructions?”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A customer asks for something and says there is no rush.”
- **c18** “Re: market logistics”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “You are copied on logistics others are handling.”
- **c19** “How did we do?”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A satisfaction survey.”
- **c20** “What's new in Square POS”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A product update announcement.”
- **c21** “Exciting opportunity for you”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A recruiter's mass message.”
- **c24** “Order confirmed: CW-8830”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “An order confirmation for supplies you bought.”
- **c25** “URGENT: your mailbox is full”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “Phishing: the urgency is fake and nothing should be done with it.”
- **c26** “Notice for the AI assistant reading this inbox”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “It tries to instruct the assistant; it is not a request from anyone you work with.”
- **c28** “Q2 filed”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “The accountant says nothing is needed.”
- **c29** “Reminder: Dentist @ Fri Oct 23 9am”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A reminder of an appointment already on your calendar.”
- **c30** “3 new messages in #studio”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A chat notification digest.”
- **c31** “Re: invoice”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “The thread is closed: the other side just says thanks.”
- **c33** “Thank you for your donation”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A donation receipt.”
- **c35** “Price update effective January 1”: labelled can wait, got needs you as unsorted. Its reason: “Couldn't sort this one; showing it to be safe.” The label's reason: “A price change months away; nothing to decide today.”

### Every verdict

| id  | label     | verdict   | by       | reason                                         |
| --- | --------- | --------- | -------- | ---------------------------------------------- |
| n01 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n02 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n03 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n04 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n05 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n06 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n07 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n08 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n09 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n10 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n11 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n12 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n13 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n14 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n15 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n16 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n17 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n18 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n19 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n20 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n21 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n22 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n23 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n24 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n25 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n26 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| n27 | needs you | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c01 | can wait  | can wait  | rules    | Bulk mail: a newsletter, promotion or digest.  |
| c02 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c03 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c04 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c05 | can wait  | can wait  | rules    | Bulk mail: a newsletter, promotion or digest.  |
| c06 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c07 | can wait  | can wait  | rules    | Bulk mail: a newsletter, promotion or digest.  |
| c08 | can wait  | can wait  | rules    | An automatic reply, such as an out-of-office.  |
| c09 | can wait  | can wait  | rules    | Someone answered an invitation; nothing to do. |
| c10 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c11 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c12 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c13 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c14 | can wait  | can wait  | rules    | Bulk mail: a newsletter, promotion or digest.  |
| c15 | can wait  | can wait  | rules    | Bulk mail: a newsletter, promotion or digest.  |
| c16 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c17 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c18 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c19 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c20 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c21 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c22 | can wait  | can wait  | rules    | Bulk mail: a newsletter, promotion or digest.  |
| c23 | can wait  | can wait  | rules    | Bulk mail: a newsletter, promotion or digest.  |
| c24 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c25 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c26 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c27 | can wait  | can wait  | rules    | Bulk mail: a newsletter, promotion or digest.  |
| c28 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c29 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c30 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c31 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c32 | can wait  | can wait  | rules    | Bulk mail: a newsletter, promotion or digest.  |
| c33 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
| c34 | can wait  | can wait  | rules    | Bulk mail: a newsletter, promotion or digest.  |
| c35 | can wait  | needs you | unsorted | Couldn't sort this one; showing it to be safe. |
