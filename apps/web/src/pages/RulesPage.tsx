import { type Decision, type Effect, type Rule, TOOLS } from "@steward/shared";
import { FlaskConical, Pencil, Plus, ShieldCheck, Trash, Undo2 } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { RuleBadge } from "@/components/cards/RuleBadge.tsx";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Card, CardHeader } from "@/components/ui/Card.tsx";
import { Dialog } from "@/components/ui/Dialog.tsx";
import { EmptyState } from "@/components/ui/EmptyState.tsx";
import { Checkbox, ChoiceGroup, Field, Input, Select, Switch, Textarea } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import {
  type DryRunInput,
  type RuleInput,
  useCreateRule,
  useDeleteRule,
  useDryRun,
  usePresets,
  useRules,
  useUpdateRule,
} from "@/lib/api.ts";
import { EFFECT_LABELS, toolLabel } from "@/lib/labels.ts";
import { RULE_EXAMPLES } from "@/lib/rule-examples.ts";

/** The variables a rule's `when` can read. They mirror the gateway's call (`GateCall` in governance.ts). */
const VARIABLES: { name: string; meaning: string }[] = [
  { name: "tool.name", meaning: 'The tool, e.g. "mail_send" or "mcp__notion__search".' },
  {
    name: "tool.kind",
    meaning: 'What it does: "read", "write", "send", "pay", "sign", "delete", "shell", "ui".',
  },
  {
    name: "tool.surface",
    meaning: 'Where: "browser", "file", "shell", "mail", "calendar", "web", "mcp", "memory", "task".',
  },
  { name: "tool.source", meaning: '"builtin", or "mcp:<server>" for a connected app.' },
  { name: "target.host", meaning: "The web address's host, e.g. example.com." },
  { name: "target.url", meaning: "The full web address." },
  { name: "target.recipients", meaning: "A list of email addresses the call reaches." },
  { name: "target.amount.value", meaning: "Money, in pence or cents." },
  { name: "target.command", meaning: "The shell command." },
  { name: "target.path", meaning: "The file path in the workspace." },
  { name: "args", meaning: "The tool's arguments, as the model sent them." },
  { name: "initiator.kind", meaning: '"person", "routine", "task", "resume" or "system".' },
  { name: "tainted", meaning: "True once the conversation has read a web page, an email or app output." },
];

const EFFECT_CHOICES: { value: Effect; label: string; description: string }[] = [
  { value: "allow", label: "Allow without asking", description: "Steward goes ahead." },
  { value: "ask", label: "Ask me first", description: "Steward shows you and waits." },
  { value: "deny", label: "Never allow", description: "Steward is refused, whatever else says." },
];

export function RulesPage() {
  const rules = useRules();
  const presets = usePresets();
  const [editing, setEditing] = useState<Rule | "new" | undefined>();

  const presetIds = new Set((presets.data ?? []).map((r) => r.id));
  const all = (rules.data ?? []).filter((r) => !presetIds.has(r.id));
  const yours = all.filter((r) => r.source === "person");
  const always = all.filter((r) => r.source === "always");
  const tenant = all.filter((r) => r.source === "tenant");
  const builtIn = presets.data ?? all.filter((r) => r.source === "preset");

  return (
    <Page
      title="Rules"
      description={
        <p>
          What Steward may do without asking. Never-allow rules win over everything. Payments and passwords
          always ask. Once Steward has read a web page or an email, anything that sends, pays, signs or
          deletes asks too, whatever the rules say.
        </p>
      }
      actions={
        <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>
          Add a rule
        </Button>
      }
    >
      {rules.isError ? (
        <ErrorNotice
          title="Couldn't load your rules"
          error={rules.error}
          onRetry={() => void rules.refetch()}
        />
      ) : null}

      <RuleSection
        id="rules-yours"
        title="Your rules"
        description="Rules you wrote. Change or remove them any time."
        loading={rules.isPending}
        rules={yours}
        empty={
          <EmptyState icon={ShieldCheck} title="No rules of your own yet" level={3}>
            Steward follows the built-in rules below. Add one to allow, ask about or refuse something
            specific.
          </EmptyState>
        }
        render={(rule) => <EditableRule rule={rule} onEdit={() => setEditing(rule)} />}
      />

      <RuleSection
        id="rules-always"
        title="Always allowed"
        description="Made when you chose Always allow on a request. Revoke one and Steward asks again next time."
        loading={rules.isPending}
        rules={always}
        empty={<p className="text-ink-2 text-sub">Nothing is always allowed yet.</p>}
        render={(rule) => <AlwaysRule rule={rule} />}
      />

      {tenant.length > 0 ? (
        <RuleSection
          id="rules-tenant"
          title="From your setup"
          description="Rules that came with this Steward's package. Switch one off here; change it in the package's rules.yaml."
          rules={tenant}
          render={(rule) => <ShippedRule rule={rule} />}
        />
      ) : null}

      <RuleSection
        id="rules-presets"
        title="Built in"
        description="Steward's own safety rules. You can switch one off here, but not change it."
        loading={presets.isPending}
        rules={builtIn}
        empty={
          presets.isError ? (
            <ErrorNotice title="Couldn't load the built-in rules" error={presets.error} />
          ) : null
        }
        render={(rule) => <ShippedRule rule={rule} />}
      />

      <DryRunTester />

      <RuleDialog
        rule={editing === "new" ? undefined : editing}
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
      />
    </Page>
  );
}

function RuleSection({
  id,
  title,
  description,
  rules,
  loading,
  empty,
  render,
}: {
  id: string;
  title: string;
  description: string;
  rules: Rule[];
  loading?: boolean;
  empty?: ReactNode;
  render: (rule: Rule) => ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div>
        <h2 id={id} className="font-semibold text-ink text-title">
          {title}
        </h2>
        <p className="mt-1 text-ink-2 text-sub">{description}</p>
      </div>
      {loading ? (
        <Loading>Loading rules…</Loading>
      ) : rules.length === 0 ? (
        empty
      ) : (
        <ul className="flex flex-col gap-3">
          {rules.map((rule) => (
            <li key={rule.id}>{render(rule)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RuleBody({ rule, children }: { rule: Rule; children?: ReactNode }) {
  const effect = EFFECT_LABELS[rule.effect];
  return (
    <Card as="article" aria-label={rule.name} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={effect.tone}>{effect.verb}</Pill>
        {!rule.enabled ? <Badge>Off</Badge> : null}
      </div>
      <h3 className="font-semibold text-body text-ink">{rule.name}</h3>
      {rule.description ? <p className="text-ink-2 text-sub">{rule.description}</p> : null}
      <p className="text-caption text-ink-2">
        <span className="sr-only">Applies when: </span>
        <code className="break-all rounded-md bg-tile px-1.5 py-0.5 text-ink">{rule.when}</code>
      </p>
      {children}
    </Card>
  );
}

/**
 * Switches a rule on or off. It sends the rule's own fields back unchanged, which is all the server
 * lets a preset or tenant rule do.
 */
function InUseSwitch({ rule }: { rule: Rule }) {
  const update = useUpdateRule();
  return (
    <Switch
      checked={rule.enabled}
      disabled={update.isPending}
      label={
        <>
          In use<span className="sr-only">: {rule.name}</span>
        </>
      }
      onCheckedChange={(enabled) =>
        update.mutate(
          {
            id: rule.id,
            name: rule.name,
            effect: rule.effect,
            when: rule.when,
            description: rule.description,
            enabled,
          },
          { onError: (error) => toast.error("Couldn't change the rule", { description: error.message }) },
        )
      }
    />
  );
}

/** A preset or tenant rule: it can be switched off here, never edited or deleted. */
function ShippedRule({ rule }: { rule: Rule }) {
  return (
    <RuleBody rule={rule}>
      <InUseSwitch rule={rule} />
    </RuleBody>
  );
}

function EditableRule({ rule, onEdit }: { rule: Rule; onEdit: () => void }) {
  const remove = useDeleteRule();
  const [confirming, setConfirming] = useState(false);
  return (
    <RuleBody rule={rule}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InUseSwitch rule={rule} />
        <div className="flex gap-2">
          <Button icon={<Pencil />} onClick={onEdit} aria-label={`Edit ${rule.name}`}>
            Edit
          </Button>
          <Button
            variant="ghost"
            icon={<Trash />}
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${rule.name}`}
          >
            Delete
          </Button>
        </div>
      </div>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        size="sm"
        title="Delete this rule?"
        description={`"${rule.name}" stops applying straight away.`}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Keep it</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(rule.id, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.success("Rule deleted", { description: rule.name });
                  },
                  onError: (error) => toast.error("Couldn't delete it", { description: error.message }),
                })
              }
            >
              Delete
            </Button>
          </>
        }
      />
    </RuleBody>
  );
}

function AlwaysRule({ rule }: { rule: Rule }) {
  const remove = useDeleteRule();
  return (
    <RuleBody rule={rule}>
      <div>
        <Button
          icon={<Undo2 />}
          loading={remove.isPending}
          aria-label={`Revoke ${rule.name}`}
          onClick={() =>
            remove.mutate(rule.id, {
              onSuccess: () =>
                toast.success("Revoked. Steward will ask next time.", { description: rule.name }),
              onError: (error) => toast.error("Couldn't revoke it", { description: error.message }),
            })
          }
        >
          Revoke
        </Button>
      </div>
    </RuleBody>
  );
}

function RuleDialog({
  rule,
  open,
  onOpenChange,
}: {
  rule?: Rule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={rule ? "Edit rule" : "Add a rule"}
      description="Rules are checked on every action, before Steward acts."
      size="lg"
    >
      {open ? <RuleForm key={rule?.id ?? "new"} rule={rule} onDone={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function RuleForm({ rule, onDone }: { rule?: Rule; onDone: () => void }) {
  const create = useCreateRule();
  const update = useUpdateRule();
  const [draft, setDraft] = useState<Required<RuleInput>>({
    name: rule?.name ?? "",
    effect: rule?.effect ?? "ask",
    when: rule?.when ?? "",
    description: rule?.description ?? "",
    enabled: rule?.enabled ?? true,
  });
  const [touched, setTouched] = useState(false);
  const mutation = rule ? update : create;
  const whenId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!draft.name.trim() || !draft.when.trim()) return;
    const body = { ...draft, name: draft.name.trim(), when: draft.when.trim() };
    const done = {
      onSuccess: () => {
        toast.success(rule ? "Rule saved" : "Rule added", { description: body.name });
        onDone();
      },
    };
    if (rule) update.mutate({ id: rule.id, ...body }, done);
    else create.mutate(body, done);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field
        label="Name"
        required
        error={touched && !draft.name.trim() ? "Give the rule a name." : undefined}
      >
        <Input
          value={draft.name}
          maxLength={120}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Ask before anything on my calendar"
        />
      </Field>
      <ChoiceGroup
        legend="What should Steward do?"
        value={draft.effect}
        onValueChange={(effect) => setDraft({ ...draft, effect })}
        choices={EFFECT_CHOICES}
      />
      <Field
        id={whenId}
        label="When"
        required
        description="A condition in CEL. Pick an example below to start from."
        error={
          touched && !draft.when.trim()
            ? "Say when the rule applies."
            : mutation.isError
              ? mutation.error.message
              : undefined
        }
      >
        <Textarea
          value={draft.when}
          rows={3}
          className="font-mono text-sub"
          spellCheck={false}
          onChange={(e) => setDraft({ ...draft, when: e.target.value })}
          placeholder='tool.surface == "calendar"'
        />
      </Field>
      <div className="flex flex-col gap-2">
        <p className="font-medium text-ink text-sub">Examples</p>
        <ul className="flex flex-col gap-1.5">
          {RULE_EXAMPLES.map((example) => (
            <li key={example.when}>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, when: example.when })}
                className="flex min-h-target w-full flex-col items-start rounded-field px-3 py-2 text-left hover:bg-tile"
              >
                <span className="text-ink text-sub">{example.meaning}</span>
                <code className="break-all text-caption text-ink-2">{example.when}</code>
              </button>
            </li>
          ))}
        </ul>
        <details>
          <summary className="inline-flex min-h-target cursor-pointer items-center text-accent text-sub underline underline-offset-4">
            What a rule can look at
          </summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sub sm:grid-cols-[auto_1fr]">
            {VARIABLES.map((v) => (
              <div key={v.name} className="contents">
                <dt>
                  <code className="text-ink">{v.name}</code>
                </dt>
                <dd className="text-ink-2">{v.meaning}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
      <Field label="Note to yourself" description="Optional. Why this rule exists.">
        <Input
          value={draft.description}
          maxLength={500}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </Field>
      <Switch
        checked={draft.enabled}
        onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
        label="In use"
        description="Switch off to keep the rule without applying it."
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          {rule ? "Save rule" : "Add rule"}
        </Button>
      </div>
    </form>
  );
}

const ARG_EXAMPLES: Record<string, Record<string, unknown>> = {
  browser_navigate: { url: "https://example.com" },
  mail_send: { to: ["someone@example.com"], subject: "Hello", body: "Just checking in." },
  calendar_create: { title: "Coffee", start: "2026-10-28T10:00:00Z", end: "2026-10-28T10:30:00Z" },
  shell_run: { command: "ls -la" },
  file_write: { path: "notes.md", content: "Hello" },
  web_fetch: { url: "https://example.com" },
};

/** "Would this be allowed?": asks the gateway to decide a made-up call without running it. */
function DryRunTester() {
  const dryRun = useDryRun();
  const [tool, setTool] = useState("mail_send");
  const [other, setOther] = useState("");
  const [args, setArgs] = useState(JSON.stringify(ARG_EXAMPLES.mail_send, null, 2));
  const [tainted, setTainted] = useState(false);
  const [initiator, setInitiator] = useState<NonNullable<DryRunInput["initiator"]>>("person");
  const [argsError, setArgsError] = useState<string | undefined>();
  const resultId = useId();

  function pickTool(name: string) {
    setTool(name);
    if (name !== "__other") setArgs(JSON.stringify(ARG_EXAMPLES[name] ?? {}, null, 2));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    let parsed: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(args || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
      parsed = value as Record<string, unknown>;
      setArgsError(undefined);
    } catch {
      setArgsError('Arguments must be a JSON object, like {"url": "https://example.com"}.');
      return;
    }
    const name = tool === "__other" ? other.trim() : tool;
    if (!name) return;
    dryRun.mutate({ tool: name, args: parsed, tainted, initiator });
  }

  return (
    <Card as="section" aria-labelledby="rules-tester">
      <CardHeader
        id="rules-tester"
        title="Would this be allowed?"
        description="Describe an action and see what Steward would do. Nothing runs and nothing is recorded."
      />
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Action">
            <Select value={tool} onChange={(e) => pickTool(e.target.value)}>
              {Object.keys(TOOLS).map((name) => (
                <option key={name} value={name}>
                  {toolLabel(name)} ({name})
                </option>
              ))}
              <option value="__other">A connected app's tool…</option>
            </Select>
          </Field>
          <Field label="Started by">
            <Select
              value={initiator}
              onChange={(e) => setInitiator(e.target.value as NonNullable<DryRunInput["initiator"]>)}
            >
              <option value="person">You, in a conversation</option>
              <option value="routine">A routine</option>
              <option value="task">A task</option>
            </Select>
          </Field>
        </div>
        {tool === "__other" ? (
          <Field label="Tool name" description="Connected app tools are named mcp__<server>__<tool>.">
            <Input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="mcp__notion__search"
            />
          </Field>
        ) : null}
        <Field label="Arguments (JSON)" error={argsError}>
          <Textarea
            value={args}
            rows={4}
            className="font-mono text-sub"
            spellCheck={false}
            onChange={(e) => setArgs(e.target.value)}
          />
        </Field>
        <Checkbox
          checked={tainted}
          onChange={(e) => setTainted(e.target.checked)}
          label="It has already read a web page or an email in this conversation"
          description="Content Steward doesn't trust can carry instructions, so risky actions then always ask."
        />
        <div>
          <Button type="submit" variant="primary" icon={<FlaskConical />} loading={dryRun.isPending}>
            Check
          </Button>
        </div>
      </form>
      <div id={resultId} aria-live="polite" className="mt-4">
        {dryRun.isError ? (
          <p role="alert" className="font-medium text-problem text-sub">
            {dryRun.error.message}
          </p>
        ) : dryRun.data ? (
          <DecisionView decision={dryRun.data} />
        ) : null}
      </div>
    </Card>
  );
}

function DecisionView({ decision }: { decision: Decision }) {
  const effect = EFFECT_LABELS[decision.effect];
  const sentence =
    decision.effect === "allow"
      ? "Steward would go ahead without asking."
      : decision.effect === "ask"
        ? "Steward would ask you first."
        : "Steward would be refused.";
  return (
    <div className="flex flex-col gap-2 rounded-field bg-tile p-4">
      <p className="flex flex-wrap items-center gap-2">
        <Pill tone={effect.tone}>{effect.label}</Pill>
        <span className="font-medium text-ink text-sub">{sentence}</span>
      </p>
      <p className="text-ink-2 text-sub">{decision.reason}</p>
      {decision.rule ? (
        <p className="text-sub">
          <span className="text-ink-2">Decided by: </span>
          <RuleBadge rule={decision.rule} />
        </p>
      ) : null}
      {decision.findings.length > 0 ? (
        <div className="text-sub">
          <p className="font-medium text-ink">Sensitive details found</p>
          <ul className="mt-1 list-disc pl-5 text-ink-2">
            {decision.findings.map((f) => (
              <li key={`${f.kind}-${f.hint}`}>
                {f.label} <span className="font-mono">{f.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
