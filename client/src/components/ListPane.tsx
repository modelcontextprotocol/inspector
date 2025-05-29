import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useMemo } from "react";

type ListPaneProps<T> = {
  items: T[];
  listItems: () => void;
  clearItems: () => void;
  setSelectedItem: (item: T) => void;
  renderItem: (item: T) => React.ReactNode;
  title: string;
  isButtonDisabled?: boolean;
  searchKey?: keyof T; // Optional key to search by
  searchPlaceholder?: string;
  buttonText?: string; // Optional button text, defaults to "Load Items"
};

const ListPane = <T extends object>({
  items,
  listItems,
  clearItems,
  setSelectedItem,
  renderItem,
  title,
  isButtonDisabled,
  searchKey,
  searchPlaceholder = "Search...",
  buttonText = "Load Items",
}: ListPaneProps<T>) => {
  const [searchTerm, setSearchTerm] = useState("");

  // Filter items based on search term
  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return items;
    
    return items.filter((item) => {
      if (searchKey && item[searchKey]) {
        // Search by specific key if provided
        const value = item[searchKey];
        return String(value).toLowerCase().includes(searchTerm.toLowerCase());
      } else {
        // Search across all string properties if no specific key is provided
        return Object.values(item).some((value) =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        );
      }
    });
  }, [items, searchTerm, searchKey]);

  const handleClearItems = () => {
    clearItems();
    setSearchTerm(""); // Clear search when clearing items
  };

  return (
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
            {buttonText}
          </Button>
          <Button
            variant="outline"
            onClick={handleClearItems}
            disabled={items.length === 0}
            className="h-7 px-2 text-xs"
          >
            Clear
          </Button>
        </div>
      </div>
      
      {/* Search input */}
      {items.length > 0 && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <Input
            type="text"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 text-sm"
          />
          {searchTerm && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Showing {filteredItems.length} of {items.length} items
            </p>
          )}
        </div>
      )}
      
      <div className="p-4">
        <div className="space-y-2 overflow-y-auto max-h-96">
          {filteredItems.length > 0 ? (
            filteredItems.map((item, index) => (
              <div
                key={index}
                className="cursor-pointer"
                onClick={() => setSelectedItem(item)}
              >
                {renderItem(item)}
              </div>
            ))
          ) : searchTerm ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <p className="text-sm">No items found matching "{searchTerm}"</p>
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <div
                key={index}
                className="cursor-pointer"
                onClick={() => setSelectedItem(item)}
              >
                {renderItem(item)}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ListPane;
