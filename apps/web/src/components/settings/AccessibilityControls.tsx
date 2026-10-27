import {
  type Contrast,
  type FontPreference,
  type MotionPreference,
  TEXT_SIZES,
  type ThemePreference,
  useAccessibility,
} from "@/app/accessibility.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { ChoiceGroup, Switch } from "@/components/ui/Field.tsx";

/**
 * Every display and reading setting in one place. Changes apply at once and are remembered in this
 * browser; plain language is saved for the agent too.
 */
export function AccessibilityControls({
  compact = false,
  showReset = true,
}: {
  /** Only text size, contrast and reading aloud: the onboarding step. */
  compact?: boolean;
  showReset?: boolean;
}) {
  const a11y = useAccessibility();
  return (
    <div className="flex flex-col gap-6">
      <ChoiceGroup
        legend="Text size"
        description="Everything grows together: words, buttons and spacing."
        value={String(a11y.textSize) as `${typeof a11y.textSize}`}
        onValueChange={(v) => a11y.setTextSize(Number(v) as typeof a11y.textSize)}
        choices={TEXT_SIZES.map((s) => ({
          value: String(s.value) as `${typeof s.value}`,
          label: (
            <span style={{ fontSize: `${s.value / 100}em` }}>
              {s.label}
              <span className="sr-only"> ({s.value}%)</span>
            </span>
          ),
        }))}
      />
      <ChoiceGroup<Contrast>
        legend="Contrast"
        value={a11y.contrast}
        onValueChange={a11y.setContrast}
        choices={[
          { value: "normal", label: "Standard" },
          { value: "more", label: "More contrast", description: "Darker words, stronger edges" },
        ]}
      />
      <Switch
        checked={a11y.readAloud}
        onCheckedChange={a11y.setReadAloud}
        label="Read replies aloud"
        description="Steward speaks its answers in Chat, using this device's voices."
      />
      {compact ? null : (
        <>
          <ChoiceGroup<ThemePreference>
            legend="Colours"
            value={a11y.theme}
            onValueChange={a11y.setTheme}
            choices={[
              { value: "system", label: "Match this device" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <ChoiceGroup<MotionPreference>
            legend="Motion"
            value={a11y.motion}
            onValueChange={a11y.setMotion}
            choices={[
              { value: "system", label: "Match this device" },
              { value: "reduce", label: "Reduce motion", description: "No sliding or spinning" },
            ]}
          />
          <ChoiceGroup<FontPreference>
            legend="Lettering"
            value={a11y.font}
            onValueChange={a11y.setFont}
            choices={[
              { value: "default", label: "Standard" },
              {
                value: "readable",
                label: (
                  <span style={{ fontFamily: "Atkinson Hyperlegible, Verdana, sans-serif" }}>
                    Easier to read
                  </span>
                ),
                description: "Clearer letter shapes, wider spacing",
              },
            ]}
          />
          <Switch
            checked={a11y.plainLanguage}
            onCheckedChange={a11y.setPlainLanguage}
            label="Plain language"
            description="Steward answers in short sentences and everyday words."
          />
        </>
      )}
      {showReset ? (
        <div>
          <Button variant="ghost" size="sm" onClick={a11y.reset}>
            Reset to the defaults
          </Button>
        </div>
      ) : null}
    </div>
  );
}
