# MCP Inspector Chatbot Test Guide

## Test Environment Setup
- **Inspector URL**: http://127.0.0.1:8080
- **Pre-configured URL**: http://127.0.0.1:8080/?transport=stdio&serverCommand=npx&serverArgs=@modelcontextprotocol/server-everything
- **MCP Server**: @modelcontextprotocol/server-everything (test server with sample tools)

## Testing Checklist

### 1. Basic UI Visibility
- [ ] Open the inspector in browser
- [ ] Connect to the MCP server (should auto-connect with query params)
- [ ] Verify chatbot icon appears in bottom-right corner (floating blue MessageCircle icon)
- [ ] Icon should only appear when MCP server is connected

### 2. Chatbot Interface
- [ ] Click chatbot icon to open chat interface
- [ ] Verify chat interface opens as a card overlay
- [ ] Check that initial "Hello! I'm here to help you interact with your MCP tools. How can I assist you today?" message appears
- [ ] Verify message input field and send button are visible
- [ ] Settings button (gear icon) should be visible in header

### 3. Settings Configuration
- [ ] Click settings button to open API key dialog
- [ ] Enter a valid OpenAI API key
- [ ] Verify key is saved to localStorage
- [ ] Close settings dialog
- [ ] Verify settings persist after closing/reopening chatbot

### 4. Basic Chat Functionality
- [ ] Send a simple message like "Hello"
- [ ] Verify message appears in chat with "user" role
- [ ] Check that OpenAI responds (requires valid API key)
- [ ] Verify assistant response appears with "assistant" role

### 5. MCP Tool Integration
- [ ] Send a message requesting tool usage like "What tools are available?"
- [ ] Verify chatbot can list available MCP tools
- [ ] Send a message that would trigger tool usage
- [ ] Verify tool calls appear with wrench icon
- [ ] Check tool execution status (pending → success/error)
- [ ] Verify tool results are displayed

### 6. Error Handling
- [ ] Test with invalid API key - should show error
- [ ] Test with no API key - should prompt for configuration
- [ ] Test when MCP server is disconnected - chatbot should hide
- [ ] Test malformed tool calls - should handle gracefully

## Expected MCP Tools from server-everything
The @modelcontextprotocol/server-everything test server provides sample tools for testing:
- Various sample tools for demonstration
- Resources for testing resource access
- Basic MCP protocol capabilities

## Implementation Verification

### Core Components Created:
- ✅ ChatBotIcon - Floating chat button
- ✅ ChatBotInterface - Main chat UI
- ✅ ChatMessage - Individual message display
- ✅ ToolCallMessage - Tool execution display
- ✅ ChatBotSettings - API key configuration
- ✅ ChatBot - Main container component

### Integration Points:
- ✅ Integrated with App.tsx
- ✅ Connected to MCP tool execution via callTool function
- ✅ OpenAI client with function calling support
- ✅ LocalStorage for API key management
- ✅ Error handling and loading states

### API Integration:
- ✅ OpenAI chat completions with tool calling
- ✅ MCP tool discovery and execution
- ✅ Tool result formatting and display
- ✅ Streaming support for responses

## Manual Test Results
_Fill in results after testing:_

- [ ] **UI Visibility**: 
- [ ] **Chat Interface**: 
- [ ] **Settings**: 
- [ ] **Basic Chat**: 
- [ ] **Tool Integration**: 
- [ ] **Error Handling**: 

## Notes
- Chatbot requires valid OpenAI API key for full functionality
- MCP server connection required for chatbot to appear
- All components use consistent UI styling with shadcn/ui
- Tool execution integrates with existing MCP inspector infrastructure
