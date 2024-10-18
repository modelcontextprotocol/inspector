import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

const PingTab = ({ onPingClick }: { onPingClick: () => void }) => {
  return (
    <TabsContent value="ping" className="grid grid-cols-2 gap-4">
      <div className="col-span-2 flex justify-center items-center">
        <Button
          onClick={onPingClick}
          className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold py-6 px-12 rounded-full shadow-lg transform transition duration-300 hover:scale-110 focus:outline-none focus:ring-4 focus:ring-purple-300 animate-pulse"
        >
          <span className="text-3xl mr-2">🚀</span>
          MEGA PING
          <span className="text-3xl ml-2">💥</span>
        </Button>
      </div>
    </TabsContent>
  );
};

export default PingTab;
