import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "@/lib/utils.ts";

/**
 * A QR code drawn as one SVG path, black on white in both themes so every phone camera reads it.
 * It is an image with a name; the same address is always next to it as a button and a copyable
 * link, because not everyone can point a camera at a screen.
 */
export function QrCode({
  value,
  label,
  size = 184,
  className,
}: {
  value: string;
  /** What the code is for, read by screen readers: "QR code to pair your iPhone". */
  label: string;
  size?: number;
  className?: string;
}) {
  const { path, modules } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { path: d, modules: qr.size };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn("shrink-0 rounded-field bg-white", className)}
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
