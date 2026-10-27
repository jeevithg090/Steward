import { type ComponentProps, createContext, type ReactNode, useContext, useId } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * Form controls that are always labelled. `Field` draws the label, the description and the error,
 * and hands their ids to the control inside it, so `Input`, `Textarea` and `Select` wire up
 * `aria-describedby` and `aria-invalid` without the page doing it by hand.
 */

interface FieldIds {
  id: string;
  descriptionId?: string;
  errorId?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldIds | undefined>(undefined);

export interface FieldProps {
  label: ReactNode;
  /** Help under the label: what to type, an example. */
  description?: ReactNode;
  /** Shown in red under the control and read with it. */
  error?: ReactNode;
  required?: boolean;
  /** Use a given id for the control (otherwise one is made). */
  id?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, description, error, required = false, id, children, className }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `${auto}-control`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  return (
    <FieldContext.Provider
      value={{ id: controlId, descriptionId, errorId, invalid: Boolean(error), required }}
    >
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={controlId} className="font-medium text-ink text-sub">
          {label}
          {required ? (
            <span className="text-ink-2">
              {" "}
              <span aria-hidden="true">*</span>
              <span className="sr-only">(required)</span>
            </span>
          ) : null}
        </label>
        {description ? (
          <p id={descriptionId} className="text-caption text-ink-2">
            {description}
          </p>
        ) : null}
        {children}
        {error ? (
          <p id={errorId} className="font-medium text-caption text-problem">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

function useFieldProps<T extends { id?: string; "aria-describedby"?: string; required?: boolean }>(props: T) {
  const field = useContext(FieldContext);
  if (!field) return props;
  const describedBy = [props["aria-describedby"], field.descriptionId, field.errorId]
    .filter(Boolean)
    .join(" ");
  return {
    ...props,
    id: props.id ?? field.id,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": field.invalid || undefined,
    required: props.required ?? (field.required || undefined),
  };
}

const control = cn(
  "w-full min-h-target rounded-field bg-card px-3 py-2 text-body text-ink",
  "shadow-[inset_0_0_0_1px_var(--st-line)] placeholder:text-ink-3",
  "disabled:cursor-not-allowed disabled:opacity-60",
  "aria-invalid:shadow-[inset_0_0_0_2px_var(--st-problem)]",
);

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...useFieldProps(props)} />;
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      className={cn(control, "resize-y leading-normal", className)}
      {...useFieldProps(props)}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "cursor-pointer pr-8", className)} {...useFieldProps(props)}>
      {children}
    </select>
  );
}

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Always present: a switch without a name is a mystery to a screen reader. */
  label: ReactNode;
  description?: ReactNode;
  /** Draw only the switch; the label is still read. */
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/** An on/off control with `role="switch"`. Its label and description are part of one 44px row. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  hideLabel = false,
  disabled,
  className,
  id,
}: SwitchProps) {
  const auto = useId();
  const switchId = id ?? `${auto}-switch`;
  const labelId = `${switchId}-label`;
  const descriptionId = description ? `${switchId}-description` : undefined;
  return (
    <div className={cn("flex min-h-target items-center justify-between gap-4", className)}>
      <div className={cn("min-w-0", hideLabel && "sr-only")}>
        <label id={labelId} htmlFor={switchId} className="font-medium text-ink text-sub">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-caption text-ink-2">
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-target w-[3.75rem] shrink-0 cursor-pointer items-center rounded-full p-0",
          "disabled:cursor-not-allowed disabled:opacity-55",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-x-1 inset-y-2.5 rounded-full transition-colors duration-(--st-dur-swap)",
            checked ? "bg-accent" : "bg-tile shadow-[inset_0_0_0_1px_var(--st-line)]",
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            "relative ml-2 size-5 rounded-full shadow-float transition-transform duration-(--st-dur-swap) ease-out-soft",
            checked ? "translate-x-6 bg-on-accent" : "bg-card",
          )}
        />
      </button>
    </div>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
}

export interface ChoiceGroupProps<T extends string> {
  legend: ReactNode;
  description?: ReactNode;
  value: T;
  onValueChange: (value: T) => void;
  choices: Choice<T>[];
  /** Lay the choices side by side (they wrap on narrow screens). */
  inline?: boolean;
  className?: string;
}

/** A set of radio buttons drawn as tiles. Native radios, so arrow keys and screen readers just work. */
export function ChoiceGroup<T extends string>({
  legend,
  description,
  value,
  onValueChange,
  choices,
  inline = true,
  className,
}: ChoiceGroupProps<T>) {
  const name = useId();
  const descriptionId = description ? `${name}-description` : undefined;
  return (
    <fieldset className={cn("min-w-0", className)} aria-describedby={descriptionId}>
      <legend className="font-medium text-ink text-sub">{legend}</legend>
      {description ? (
        <p id={descriptionId} className="mt-1 text-caption text-ink-2">
          {description}
        </p>
      ) : null}
      <div className={cn("mt-2 gap-2", inline ? "flex flex-wrap" : "grid")}>
        {choices.map((choice) => {
          const checked = choice.value === value;
          const hintId = choice.description ? `${name}-${choice.value}-hint` : undefined;
          return (
            <label
              key={choice.value}
              className={cn(
                "relative flex min-h-target cursor-pointer items-center gap-2 rounded-field px-3 py-2 text-sub",
                checked
                  ? "bg-accent-soft font-medium text-ink shadow-[inset_0_0_0_2px_var(--st-accent)]"
                  : "bg-card text-ink shadow-[inset_0_0_0_1px_var(--st-line)] hover:bg-tile",
              )}
            >
              <input
                type="radio"
                name={name}
                value={choice.value}
                checked={checked}
                aria-describedby={hintId}
                onChange={() => onValueChange(choice.value)}
                className="size-4 shrink-0 accent-(--st-accent)"
              />
              <span>
                {choice.label}
                {choice.description ? (
                  // Read as the radio's description, not as part of its name.
                  <span id={hintId} aria-hidden="true" className="block font-normal text-caption text-ink-2">
                    {choice.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface CheckboxProps extends Omit<ComponentProps<"input">, "type"> {
  label: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ label, description, className, id, ...props }: CheckboxProps) {
  const auto = useId();
  const boxId = id ?? `${auto}-checkbox`;
  const descriptionId = description ? `${boxId}-description` : undefined;
  return (
    <div className={cn("flex min-h-target items-start gap-3 py-2", className)}>
      <input
        id={boxId}
        type="checkbox"
        aria-describedby={descriptionId}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-(--st-accent)"
        {...props}
      />
      <div>
        <label htmlFor={boxId} className="cursor-pointer font-medium text-ink text-sub">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-caption text-ink-2">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
