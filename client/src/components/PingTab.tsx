import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

const PingTab = ({ onPingClick }: { onPingClick: () => void }) => {
  return (
    <TabsContent value="ping" className="h-full mt-0 focus-visible:ring-0">
      <div className="flex justify-center items-center h-full">
        <div className="col-span-2 flex justify-center items-center">
          <Button
            onClick={onPingClick}
            className="font-bold py-6 px-12 rounded-full"
          >
            Ping Server
          </Button>
        </div>
      </div>
    </TabsContent>
  );
};

export default PingTab;
