import type { Settings } from "@steward/shared";
import { Bell, Bot, Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { TimezoneSelect } from "@/components/forms/TimezoneSelect.tsx";
import { AccessibilityControls } from "@/components/settings/AccessibilityControls.tsx";
import { SetupChecklist } from "@/components/setup/SetupChecklist.tsx";
import { Badge } from "@/components/ui/Badge.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Card, CardHeader } from "@/components/ui/Card.tsx";
import { Field, Input, Select } from "@/components/ui/Field.tsx";
import { ErrorNotice, Loading } from "@/components/ui/Notice.tsx";
import { Page } from "@/components/ui/PageHeader.tsx";
import { Pill } from "@/components/ui/Pill.tsx";
import { type SettingsInput, useInfo, useSettings, useUpdateSettings } from "@/lib/api.ts";
import {
  type NotificationPermissionState,
  notificationPermission,
  requestNotificationPermission,
} from "@/lib/notify.ts";

export function SettingsPage() {
  return (
    <Page title="Settings" description="How Steward looks, reads and runs.">
      <Card as="section" aria-labelledby="settings-setup">
        <CardHeader
          id="settings-setup"
          title="Setup"
          description="What is ready and what still needs setting up. Ready means Steward checked it works."
        />
        <div className="mt-4">
          <SetupChecklist />
        </div>
      </Card>

      <Card as="section" aria-labelledby="settings-a11y">
        <CardHeader
          id="settings-a11y"
          title="Accessibility"
          description="These apply straight away and are remembered on this device."
        />
        <div className="mt-5">
          <AccessibilityControls />
        </div>
      </Card>

      <ModelSection />
      <ScheduleSection />
      <NotificationsSection />
    </Page>
  );
}

const PROVIDERS: { value: NonNullable<SettingsInput["model"]>["provider"]; label: string }[] = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "nvidia", label: "NVIDIA" },
  { value: "gemini", label: "Google Gemini" },
  { value: "ollama", label: "Ollama (on this computer)" },
  { value: "openai-compatible", label: "Another OpenAI-compatible server" },
  { value: "scripted", label: "Scripted (for demos and tests)" },
];

function ModelSection() {
  const info = useInfo();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<NonNullable<SettingsInput["model"]>["provider"]>("openrouter");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const current = settings.data?.model ?? info.data?.model;
  const scripted = info.data?.model.scripted ?? false;

  function startEditing() {
    const known = PROVIDERS.find((p) => p.value === current?.provider);
    setProvider(known?.value ?? "openrouter");
    setModel(current?.model ?? "");
    setBaseUrl(settings.data?.model.baseUrl ?? "");
    setEditing(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!model.trim()) return;
    update.mutate(
      { model: { provider, model: model.trim(), baseUrl: baseUrl.trim() || undefined } },
      {
        onSuccess: () => {
          toast.success("Model saved", { description: `${provider} · ${model.trim()}` });
          setEditing(false);
        },
      },
    );
  }

  return (
    <Card as="section" aria-labelledby="settings-model">
      <CardHeader
        id="settings-model"
        title={
          <span className="flex items-center gap-2">
            <Bot aria-hidden="true" className="size-5 text-ink-2" />
            Model
          </span>
        }
        description="The AI model Steward thinks with. Steward sends your conversations to this provider and nowhere else."
      />
      {settings.isPending && info.isPending ? (
        <Loading>Loading…</Loading>
      ) : current ? (
        <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sub">
          <dt className="text-ink-2">Provider</dt>
          <dd className="flex flex-wrap items-center gap-2 text-ink">
            {PROVIDERS.find((p) => p.value === current.provider)?.label ?? current.provider}
            {scripted ? <Badge tone="needs">Scripted</Badge> : null}
          </dd>
          <dt className="text-ink-2">Model</dt>
          <dd className="break-all font-mono text-ink">{current.model}</dd>
        </dl>
      ) : (
        <ErrorNotice className="mt-4" title="Couldn't load the model" error={settings.error ?? info.error} />
      )}
      <p className="mt-4 text-ink-2 text-sub">
        {scripted ? "The scripted model gives fixed answers so you can try Steward without a key. " : ""}
        To change it for good, set <code>STEWARD_MODEL_PROVIDER</code>, <code>STEWARD_MODEL</code> and the
        provider's key in <code>.env</code>, then restart Steward. Keys are only ever read from there.
      </p>
      {editing ? (
        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider">
              <Select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Model" required>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="font-mono"
                spellCheck={false}
                placeholder="anthropic/claude-sonnet-5.5"
              />
            </Field>
          </div>
          {provider === "ollama" || provider === "openai-compatible" ? (
            <Field label="Server address" description="For example http://127.0.0.1:11434/v1">
              <Input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                spellCheck={false}
              />
            </Field>
          ) : null}
          {update.isError ? (
            <p role="alert" className="font-medium text-problem text-sub">
              {update.error.message}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" icon={<Save />} loading={update.isPending}>
              Use this model
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button className="mt-4" onClick={startEditing}>
          Try another model
        </Button>
      )}
    </Card>
  );
}

function ScheduleSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<
    Pick<Settings, "briefTime" | "timezone" | "approvalExpiryHours"> | undefined
  >();

  useEffect(() => {
    if (settings.data && !draft) {
      const { briefTime, timezone, approvalExpiryHours } = settings.data;
      setDraft({ briefTime, timezone, approvalExpiryHours });
    }
  }, [settings.data, draft]);

  const expiryOk = draft
    ? Number.isInteger(draft.approvalExpiryHours) &&
      draft.approvalExpiryHours >= 1 &&
      draft.approvalExpiryHours <= 168
    : true;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !expiryOk) return;
    update.mutate(draft, { onSuccess: () => toast.success("Settings saved") });
  }

  return (
    <Card as="section" aria-labelledby="settings-schedule">
      <CardHeader
        id="settings-schedule"
        title="Brief and requests"
        description="When the morning brief is made, and how long Steward waits for an answer."
      />
      {settings.isPending ? (
        <Loading>Loading…</Loading>
      ) : settings.isError ? (
        <ErrorNotice
          className="mt-4"
          title="Couldn't load your settings"
          error={settings.error}
          onRetry={() => void settings.refetch()}
        />
      ) : draft ? (
        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brief time" description="Steward makes your brief at this time each morning.">
              <Input
                type="time"
                value={draft.briefTime}
                onChange={(e) => setDraft({ ...draft, briefTime: e.target.value })}
              />
            </Field>
            <Field label="Time zone" description="For the brief, routines and times on screen.">
              <TimezoneSelect
                value={draft.timezone}
                onChange={(timezone) => setDraft({ ...draft, timezone })}
              />
            </Field>
          </div>
          <Field
            label="Requests expire after (hours)"
            description="If nobody answers a request in this time, Steward doesn't do it. Between 1 and 168."
            error={expiryOk ? undefined : "Choose a whole number of hours from 1 to 168."}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={168}
              step={1}
              value={Number.isNaN(draft.approvalExpiryHours) ? "" : draft.approvalExpiryHours}
              onChange={(e) => setDraft({ ...draft, approvalExpiryHours: e.target.valueAsNumber })}
              className="max-w-40"
            />
          </Field>
          {update.isError ? (
            <p role="alert" className="font-medium text-problem text-sub">
              {update.error.message}
            </p>
          ) : null}
          <div>
            <Button type="submit" variant="primary" icon={<Save />} loading={update.isPending}>
              Save
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

const PERMISSION_TEXT: Record<NotificationPermissionState, string> = {
  granted: "On. Steward tells you in this browser when it needs you and the tab is in the background.",
  default: "Off. Turn them on so Steward can tell you when it needs your answer.",
  denied:
    "Notifications are blocked for this site. Allow them in your browser's site settings to turn them on.",
  unsupported: "This browser can't show notifications.",
};

function NotificationsSection() {
  const [permission, setPermission] = useState<NotificationPermissionState>(notificationPermission);
  return (
    <Card as="section" aria-labelledby="settings-notify">
      <CardHeader
        id="settings-notify"
        title={
          <span className="flex items-center gap-2">
            <Bell aria-hidden="true" className="size-5 text-ink-2" />
            Notifications
          </span>
        }
        actions={
          permission === "granted" ? (
            <Pill tone="done">On</Pill>
          ) : permission === "denied" ? (
            <Pill tone="problem">Blocked</Pill>
          ) : (
            <Pill tone="neutral">Off</Pill>
          )
        }
      />
      <p className="mt-3 text-ink-2 text-sub" aria-live="polite">
        {PERMISSION_TEXT[permission]}
      </p>
      {permission === "default" ? (
        <Button
          className="mt-4"
          variant="primary"
          onClick={async () => setPermission(await requestNotificationPermission())}
        >
          Turn on notifications
        </Button>
      ) : null}
    </Card>
  );
}
