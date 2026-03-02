import { GripVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) => (
  <ResizablePrimitive.Group
    className={cn(
      "flex h-full w-full data-[orientation=vertical]:flex-col",
      className,
    )}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;
const useDefaultLayout = ResizablePrimitive.useDefaultLayout;

const ResizableHandle = ({
  className,
  withHandle,
  children,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.Separator
    className={cn(
      "relative flex items-center justify-center bg-border transition-colors hover:bg-primary/50",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-3.5 w-2.5 items-center justify-center rounded-sm border bg-border shadow-sm">
        {children}
      </div>
    )}
  </ResizablePrimitive.Separator>
);

const HorizontalHandle = (
  props: React.ComponentProps<typeof ResizableHandle>,
) => (
  <ResizableHandle
    {...props}
    className={cn("w-px h-full cursor-col-resize", props.className)}
  >
    <GripVertical className="h-2 w-2" />
  </ResizableHandle>
);

const VerticalHandle = (
  props: React.ComponentProps<typeof ResizableHandle>,
) => (
  <ResizableHandle
    {...props}
    className={cn("h-px w-full cursor-row-resize", props.className)}
  >
    <GripVertical className="h-2 w-2 rotate-90" />
  </ResizableHandle>
);

export {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  VerticalHandle,
  HorizontalHandle,
  useDefaultLayout,
};
