import { cn } from "@/lib/utils";

type ResizerProps = {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  axis: "x" | "y";
  className?: string;
};

export const Resizer = ({
  onMouseDown,
  onDoubleClick,
  axis,
  className,
}: ResizerProps) => {
  const isX = axis === "x";

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        "flex items-center justify-center hover:bg-accent/50 dark:hover:bg-input/40 transition-colors z-10",
        isX ? "cursor-col-resize w-4 h-full" : "cursor-row-resize h-4 w-full",
        className,
      )}
    >
      <div
        className={cn("bg-border rounded-full", isX ? "w-1 h-8" : "h-1 w-8")}
      />
    </div>
  );
};
