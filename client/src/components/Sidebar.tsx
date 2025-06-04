import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useTheme from "../lib/hooks/useTheme";
import { version } from "../../../package.json";

const Sidebar = () => {
  const [theme, setTheme] = useTheme();

  // Determine which logo to show based on theme
  const getLogoSrc = () => {
    if (theme === "dark") {
      return "/mcp_jam_dark.png";
    } else if (theme === "light") {
      return "/mcp_jam_light.png";
    } else {
      // For system theme, check if dark mode is active
      const isDarkMode = document.documentElement.classList.contains("dark");
      return isDarkMode ? "/mcp_jam_dark.png" : "/mcp_jam_light.png";
    }
  };

  return (
    <div className="w-80 bg-card border-r border-border flex flex-col h-full">
      {/* Logo and Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex flex-col items-center space-y-2">
          {/* MCP Jam Logo */}
          <div className="w-full flex justify-center">
            <img
              src={getLogoSrc()}
              alt="MCP Jam"
              className="h-6 w-auto object-contain transition-opacity duration-200"
              onError={(e) => {
                console.warn("Failed to load MCP Jam logo");
                e.currentTarget.style.display = "none";
              }}
            />
          </div>

          {/* Title */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground opacity-70">
              v{version}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Area - Now empty, can be used for other navigation or features */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                Navigate using the tabs above
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Saved requests are now available in the Tools tab
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Theme Selector */}
      <div className="p-4 border-t">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Theme</span>
          <Select
            value={theme}
            onValueChange={(value: string) =>
              setTheme(value as "system" | "light" | "dark")
            }
          >
            <SelectTrigger className="w-[100px]" id="theme-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
