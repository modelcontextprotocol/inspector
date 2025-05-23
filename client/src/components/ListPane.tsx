import { Button } from "./ui/button";

type ListPaneProps<T> = {
  items: T[];
  listItems: () => void;
  clearItems: () => void;
  setSelectedItem: (item: T) => void;
  renderItem: (item: T) => React.ReactNode;
  title: string;
  isButtonDisabled?: boolean;
};

const ListPane = <T extends object>({
  items,
  listItems,
  clearItems,
  setSelectedItem,
  renderItem,
  title,
  isButtonDisabled,
}: ListPaneProps<T>) => (
  <div className="bg-card rounded-lg shadow">
    <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
      <h3 className="font-semibold dark:text-white">{title}</h3>
      <div className="flex gap-1">
        <Button
          variant="outline"
          onClick={listItems}
          disabled={isButtonDisabled}
          className="h-7 px-2 text-xs"
        >
          Load Tools
        </Button>
        <Button
          variant="outline"
          onClick={clearItems}
          disabled={items.length === 0}
          className="h-7 px-2 text-xs"
        >
          Clear
        </Button>
      </div>
    </div>
    <div className="p-4">
      <div className="space-y-2 overflow-y-auto max-h-96">
        {items.map((item, index) => (
          <div
            key={index}
            className="cursor-pointer"
            onClick={() => setSelectedItem(item)}
          >
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default ListPane;
