import { useMemo } from "react";
import { Select } from "@/components/ui/Field.tsx";
import { browserTimeZone } from "@/lib/utils.ts";

function allTimeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return ["UTC", browserTimeZone()];
  }
}

/** Every IANA time zone the browser knows, the person's own first. Use inside a `Field`. */
export function TimezoneSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (zone: string) => void;
  id?: string;
}) {
  const zones = useMemo(() => {
    const list = allTimeZones();
    const own = browserTimeZone();
    const withValue = value && !list.includes(value) ? [value, ...list] : list;
    return [own, ...withValue.filter((z) => z !== own)];
  }, [value]);
  return (
    <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {zones.map((zone, i) => (
        <option key={zone} value={zone}>
          {zone.replaceAll("_", " ")}
          {i === 0 ? " (this device)" : ""}
        </option>
      ))}
    </Select>
  );
}
