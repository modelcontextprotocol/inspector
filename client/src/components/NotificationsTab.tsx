import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TabsContent } from "@/components/ui/tabs";

const NotificationsTab = () => (
  <TabsContent value="notifications" className="space-y-4">
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-4">
        <div className="flex space-x-2">
          <Input placeholder="Notification method" />
          <Button>
            <Bell className="w-4 h-4 mr-2" />
            Send
          </Button>
        </div>
        <Textarea
          placeholder="Notification parameters (JSON)"
          className="h-64 font-mono"
        />
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold mb-4">Recent Notifications</h3>
        <div className="space-y-2">
          {/* Notification history would go here */}
        </div>
      </div>
    </div>
  </TabsContent>
);

export default NotificationsTab;
