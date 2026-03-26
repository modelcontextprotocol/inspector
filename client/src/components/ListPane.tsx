import { Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useMemo } from "react";

type ListPaneProps<T> = {
  items: T[];
  listItems: () => void;
  clearItems?: () => void;
  selectedItem?: T | null;
  setSelectedItem: (item: T) => void;
  renderItem: (item: T) => React.ReactNode;
  title: string;
  buttonText: string;
  isButtonDisabled?: boolean;
  searchRef?: React.RefObject<HTMLInputElement | null>;
};

const ListPane = <T extends object>({
  items,
  listItems,
  clearItems,
  selectedItem,
  setSelectedItem,
  renderItem,
  title,
  buttonText,
  isButtonDisabled,
  searchRef,
}: ListPaneProps<T>) => {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;

    return items.filter((item) => {
      const searchableText = [
        (item as { name?: string }).name || "",
        (item as { description?: string }).description || "",
      ]
        .join(" ")
        .toLowerCase();
      return searchableText.includes(searchQuery.toLowerCase());
    });
  }, [items, searchQuery]);

  return (
    <div className="bg-card border border-border rounded-lg shadow overflow-hidden flex flex-col h-full">
      <div className="p-4 border-b border-gray-200 dark:border-border h-16 flex items-center flex-shrink-0">
        <h3 className="font-semibold dark:text-white flex-shrink-0">{title}</h3>
      </div>
      <div className="p-4 flex flex-col flex-1 min-h-0 overflow-hidden">
        <div
          className={`grid ${clearItems ? "grid-cols-2" : "grid-cols-1"} gap-2 mb-4 flex-shrink-0`}
        >
          <Button
            variant="outline"
            className="w-full"
            onClick={listItems}
            disabled={isButtonDisabled}
          >
            {buttonText}
          </Button>
          {clearItems && (
            <Button
              variant="outline"
              className="w-full"
              onClick={clearItems}
              disabled={items.length === 0}
            >
              Clear
            </Button>
          )}
        </div>
        {items.length > 3 && (
          <div className="relative mb-4 flex-shrink-0">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
            <Input
              ref={searchRef}
              name="search"
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10 w-full"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  searchRef?.current?.focus();
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors z-10"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        <div className="space-y-2 overflow-y-auto flex-1 min-h-0">
          {filteredItems.map((item, index) => (
            <div
              key={index}
              className={`flex items-center py-2 px-2 rounded cursor-pointer transition-colors ${
                selectedItem === item
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-gray-700 dark:hover:text-white"
              }`}
              onClick={() => setSelectedItem(item)}
            >
              {renderItem(item)}
            </div>
          ))}
          {filteredItems.length === 0 && searchQuery && items.length > 0 && (
            <div className="text-center py-4 text-muted-foreground">
              No items found matching &quot;{searchQuery}&quot;
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ListPane;
