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
      "relative flex items-center justify-center bg-border transition-colors data-[separator=hover]:!bg-primary/50 data-[separator=active]:!bg-primary",
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

const HorizontalHandle = ({
  onDoubleClick,
  ...props
}: React.ComponentProps<typeof ResizableHandle>) => (
  <div
    onDoubleClick={onDoubleClick}
    className="h-full flex items-center cursor-col-resize"
  >
    <ResizableHandle {...props} className={cn("w-px h-full", props.className)}>
      <GripVertical className="h-2 w-2" />
    </ResizableHandle>
  </div>
);

const VerticalHandle = ({
  onDoubleClick,
  ...props
}: React.ComponentProps<typeof ResizableHandle>) => (
  <div
    onDoubleClick={onDoubleClick}
    className="w-full flex justify-center cursor-row-resize"
  >
    <ResizableHandle {...props} className={cn("h-px w-full", props.className)}>
      <GripVertical className="h-2 w-2 rotate-90" />
    </ResizableHandle>
  </div>
);

export {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  VerticalHandle,
  HorizontalHandle,
  useDefaultLayout,
};
