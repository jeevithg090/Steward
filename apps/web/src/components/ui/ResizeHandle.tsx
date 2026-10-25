import type { ResizableHandleProps } from "../../hooks/useResizable";

interface ResizeHandleProps {
  label: string;
  value: number;
  min: number;
  max: number;
  handleProps: ResizableHandleProps;
}

/** Vertical drag bar. Double-click resets the width. Desktop only. */
export function ResizeHandle({ label, value, min, max, handleProps }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      {...handleProps}
      className="group/handle hidden w-3 shrink-0 cursor-col-resize touch-none select-none items-center justify-center focus:outline-none lg:flex"
    >
      <span className="h-12 w-1 rounded-full bg-white/15 transition-colors group-hover/handle:bg-white/50 group-focus-visible/handle:bg-white motion-reduce:transition-none" />
    </div>
  );
}