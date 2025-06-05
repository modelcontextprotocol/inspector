import { useState, useCallback, useEffect } from "react";
import { InspectorConfig } from "../lib/configurationTypes";
import { AuthDebuggerState } from "../lib/auth-types";
import { initializeInspectorConfig } from "../utils/configUtils";

const CONFIG_LOCAL_STORAGE_KEY = "inspectorConfig_v1";
const CLAUDE_API_KEY_STORAGE_KEY = "claude-api-key";

// Validate Claude API key format
const validateClaudeApiKey = (key: string): boolean => {
  const claudeApiKeyPattern = /^sk-ant-api03-[A-Za-z0-9_-]+$/;
  return claudeApiKeyPattern.test(key) && key.length > 20;
};

export const useConfigState = () => {
  const [config, setConfig] = useState<InspectorConfig>(() =>
    initializeInspectorConfig(CONFIG_LOCAL_STORAGE_KEY),
  );

  const [bearerToken, setBearerToken] = useState<string>(() => {
    return localStorage.getItem("lastBearerToken") || "";
  });

  const [headerName, setHeaderName] = useState<string>(() => {
    return localStorage.getItem("lastHeaderName") || "";
  });

  const [claudeApiKey, setClaudeApiKey] = useState<string>(() => {
    try {
      const storedApiKey =
        localStorage.getItem(CLAUDE_API_KEY_STORAGE_KEY) || "";
      if (storedApiKey && validateClaudeApiKey(storedApiKey)) {
        return storedApiKey;
      }
    } catch (error) {
      console.warn("Failed to load Claude API key from localStorage:", error);
    }
    return "";
  });

  const [currentPage, setCurrentPage] = useState<string>(() => {
    const hash = window.location.hash.slice(1);
    return hash || "tools";
  });

  // Auth debugger state
  const [authState, setAuthState] = useState<AuthDebuggerState>({
    isInitiatingAuth: false,
    oauthTokens: null,
    loading: true,
    oauthStep: "metadata_discovery",
    oauthMetadata: null,
    oauthClientInfo: null,
    authorizationUrl: null,
    authorizationCode: "",
    latestError: null,
    statusMessage: null,
    validationError: null,
  });

  // Helper function to update specific auth state properties
  const updateAuthState = useCallback((updates: Partial<AuthDebuggerState>) => {
    setAuthState((prev) => ({ ...prev, ...updates }));
  }, []);

  // Update Claude API key with validation and storage
  const updateClaudeApiKey = useCallback((newApiKey: string) => {
    setClaudeApiKey(newApiKey);

    try {
      if (newApiKey && validateClaudeApiKey(newApiKey)) {
        localStorage.setItem(CLAUDE_API_KEY_STORAGE_KEY, newApiKey);
      } else if (!newApiKey) {
        localStorage.removeItem(CLAUDE_API_KEY_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Failed to save Claude API key to localStorage:", error);
    }
  }, []);

  // Persist config to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(CONFIG_LOCAL_STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  // Persist bearer token whenever it changes
  useEffect(() => {
    localStorage.setItem("lastBearerToken", bearerToken);
  }, [bearerToken]);

  // Persist header name whenever it changes
  useEffect(() => {
    localStorage.setItem("lastHeaderName", headerName);
  }, [headerName]);

  // Handle hash changes for navigation
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        setCurrentPage(hash);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Ensure default hash is set
  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = "tools";
    }
  }, []);

  return {
    config,
    setConfig,
    bearerToken,
    setBearerToken,
    headerName,
    setHeaderName,
    claudeApiKey,
    updateClaudeApiKey,
    currentPage,
    setCurrentPage,
    authState,
    updateAuthState,
    validateClaudeApiKey,
  };
};
