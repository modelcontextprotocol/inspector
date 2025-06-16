import { Button } from "./ui/button";
import React, { useState } from "react"; // Import React and useState
import MetaEditor from "./MetaEditor"; // Import MetaEditor

type ListPaneProps<T> = {
  items: T[];
  listItems: (meta?: Record<string, unknown> | null) => void; // Updated signature
  clearItems: () => void;
  setSelectedItem: (item: T) => void;
  renderItem: (item: T) => React.ReactNode;
  title: string;
  buttonText: string;
  isButtonDisabled?: boolean;
};

const ListPane = <T extends object>({
  items,
  listItems,
  clearItems,
  setSelectedItem,
  renderItem,
  title,
  buttonText,
  isButtonDisabled,
}: ListPaneProps<T>) => {
  const [metaValue, setMetaValue] = useState<Record<string, unknown> | null>(
    null,
  );

  return (
    <div className="bg-card border border-border rounded-lg shadow">
      <div className="p-4 border-b border-gray-200 dark:border-border">
        <h3 className="font-semibold dark:text-white">{title}</h3>
      </div>
      <div className="p-4">
        <MetaEditor
          onChange={setMetaValue}
          initialCollapsed={true}
          initialValue={{}}
        />
        <Button
          variant="outline"
          className="w-full mb-4 mt-2" // Added mt-2 for spacing after MetaEditor
          onClick={() => listItems(metaValue)} // Pass metaValue
          disabled={isButtonDisabled}
        >
          {buttonText}
        </Button>
        <Button
          variant="outline"
          className="w-full mb-4"
          onClick={clearItems}
          disabled={items.length === 0}
        >
          Clear
        </Button>
        <div className="space-y-2 overflow-y-auto max-h-96">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex items-center py-2 px-4 rounded hover:bg-gray-50 dark:hover:bg-secondary cursor-pointer"
              onClick={() => setSelectedItem(item)}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ListPane;
