// Configuration for the chatbot
export const CHATBOT_CONFIG = {
  // In a production environment, this should be handled via environment variables
  // or a secure configuration system. For the inspector, we'll use localStorage
  getOpenAIApiKey: (): string => {
    return localStorage.getItem("openai_api_key") || "";
  },
  
  setOpenAIApiKey: (apiKey: string): void => {
    if (apiKey) {
      localStorage.setItem("openai_api_key", apiKey);
    } else {
      localStorage.removeItem("openai_api_key");
    }
  },
  
  hasApiKey: (): boolean => {
    const key = localStorage.getItem("openai_api_key");
    return !!(key && key.trim().length > 0);
  }
};

export const DEFAULT_WELCOME_MESSAGE = "Hello! I'm your MCP Assistant. I can help you interact with the connected MCP tools and answer questions about your system. What can I help you with today?";
