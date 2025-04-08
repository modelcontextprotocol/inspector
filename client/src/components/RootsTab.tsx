import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { Root } from "@modelcontextprotocol/sdk/types.js";
import { Plus, Minus, Save } from "lucide-react";

const RootsTab = ({
  roots,
  setRoots,
  onRootsChange,
}: {
  roots: Root[];
  setRoots: React.Dispatch<React.SetStateAction<Root[]>>;
  onRootsChange: () => void;
}) => {
  const addRoot = () => {
    setRoots((currentRoots) => [...currentRoots, { uri: "file://", name: "" }]);
  };

  const removeRoot = (index: number) => {
    setRoots((currentRoots) => currentRoots.filter((_, i) => i !== index));
  };

  const updateRoot = (index: number, field: keyof Root, value: string) => {
    setRoots((currentRoots) =>
      currentRoots.map((root, i) =>
        i === index ? { ...root, [field]: value } : root,
      ),
    );
  };

  const handleSave = () => {
    onRootsChange();
  };

  return (
    <TabsContent value="roots">
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            Configure the root directories that the server can access
          </AlertDescription>
        </Alert>

        {roots.map((root, index) => (
          <div key={index} className="flex gap-2 items-center">
            <Input
              placeholder="file:// URI"
              value={root.uri}
              onChange={(e) => updateRoot(index, "uri", e.target.value)}
              className="flex-1"
            />
            <Button
              variant="destructive"
              size="sm"
              onClick={() => removeRoot(index)}
            >
              <Minus className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <div className="flex gap-2">
          <Button variant="outline" onClick={addRoot}>
            <Plus className="h-4 w-4 mr-2" />
            Add Root
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>
    </TabsContent>
  );
};

export default RootsTab;
