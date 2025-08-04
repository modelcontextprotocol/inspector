import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/lib/hooks/useToast";

interface PingTabProps {
  onPingClick?: () => Promise<void> | void;
}

export default function PingTab({ onPingClick }: PingTabProps) {
  const [isPinging, setIsPinging] = useState(false);
  const { toast } = useToast();

  const handlePingClick = async () => {
    try {
      setIsPinging(true);

      // Show loading toast
      toast({
        title: "Ping Initiated",
        description: "Sending ping request to the server...",
        duration: 5000, // Auto-dismiss after 5 seconds
      });

      if (onPingClick) {
        await onPingClick();
      }

      // Show success toast when ping completes
      toast({
        title: "Ping Successful",
        description: "Server responded to ping request",
        variant: "default",
        duration: 5000, // Auto-dismiss after 5 seconds
      });
    } catch (error) {
      // Show error toast if ping fails
      toast({
        title: "Ping Failed",
        description:
          error instanceof Error ? error.message : "Failed to ping server",
        variant: "destructive",
        duration: 5000, // Auto-dismiss after 5 seconds
      });
    } finally {
      setIsPinging(false);
    }
  };

  return (
    <TabsContent value="ping">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 flex flex-col justify-center items-center gap-4">
          <Button
            onClick={handlePingClick}
            disabled={isPinging}
            className="flex items-center gap-2 font-bold py-6 px-12 rounded-full"
          >
            <Bell className="h-4 w-4" />
            {isPinging ? "Pinging..." : "Ping Server"}
          </Button>
        </div>
      </div>
    </TabsContent>
  );
}
