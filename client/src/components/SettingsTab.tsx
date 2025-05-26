import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Key, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/lib/hooks/useToast";

interface SettingsTabProps {
  onApiKeyChange: (apiKey: string) => void;
  disabled?: boolean;
}

const STORAGE_KEY = "claude-api-key";

const SettingsTab: React.FC<SettingsTabProps> = ({
  onApiKeyChange,
  disabled = false,
}) => {
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isValidKey, setIsValidKey] = useState(false);
  const { toast } = useToast();

  // Load API key from localStorage on mount
  useEffect(() => {
    try {
      const storedApiKey = localStorage.getItem(STORAGE_KEY) || "";
      if (storedApiKey) {
        setApiKey(storedApiKey);
        const isValid = validateApiKey(storedApiKey);
        setIsValidKey(isValid);
        onApiKeyChange(storedApiKey);
      }
    } catch (error) {
      console.warn("Failed to load API key from localStorage:", error);
    }
  }, [onApiKeyChange]);

  // Validate API key format
  const validateApiKey = (key: string): boolean => {
    // Claude API keys start with "sk-ant-api03-" and are followed by base64-like characters
    const claudeApiKeyPattern = /^sk-ant-api03-[A-Za-z0-9_-]+$/;
    return claudeApiKeyPattern.test(key) && key.length > 20;
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    const isValid = validateApiKey(value);
    setIsValidKey(isValid);

    if (isValid) {
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch (error) {
        console.warn("Failed to save API key to localStorage:", error);
      }
      onApiKeyChange(value);
      toast({
        title: "API Key Set",
        description:
          "Your Claude API key has been saved and configured successfully.",
        variant: "default",
      });
    } else if (value.length > 0) {
      onApiKeyChange("");
    } else {
      onApiKeyChange("");
    }
  };

  const clearApiKey = () => {
    setApiKey("");
    setIsValidKey(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("Failed to remove API key from localStorage:", error);
    }
    onApiKeyChange("");
    toast({
      title: "API Key Cleared",
      description: "Your Claude API key has been removed from storage.",
      variant: "default",
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Key className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Claude API Key
          </h3>
          {isValidKey && (
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
          )}
          {apiKey.length > 0 && !isValidKey && (
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          )}
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                type={showApiKey ? "text" : "password"}
                placeholder="Enter your Claude API key (sk-ant-api03-...)"
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                disabled={disabled}
                className={`font-mono pr-10 ${
                  apiKey.length > 0
                    ? isValidKey
                      ? "border-green-500 dark:border-green-400"
                      : "border-red-500 dark:border-red-400"
                    : ""
                }`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8"
                onClick={() => setShowApiKey(!showApiKey)}
                disabled={disabled}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            {apiKey.length > 0 && (
              <Button
                variant="outline"
                onClick={clearApiKey}
                disabled={disabled}
                className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-red-400/60 dark:hover:border-red-500/60 hover:bg-red-50/80 dark:hover:bg-red-900/20"
              >
                Clear
              </Button>
            )}
          </div>

          {apiKey.length > 0 && !isValidKey && (
            <p className="text-sm text-red-600 dark:text-red-400">
              Please enter a valid Claude API key starting with "sk-ant-api03-"
            </p>
          )}

          {!apiKey.length && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Enter your Claude API key to enable the chat functionality. Your
              key will be securely stored in your browser's local storage.
            </p>
          )}

          {isValidKey && (
            <p className="text-sm text-green-600 dark:text-green-400">
              ✓ Valid API key configured. Chat functionality is now available.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsTab;
