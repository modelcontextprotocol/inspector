# Inspector V2 Scope

### [Brief](README.md) | [V1 Problems](v1_problems.md) | V2 Scope | [V2 Tech Stack](v2_tech_stack.md) | [V2 UX](v2_ux.md)

## Table of Contents
  * [Protocol Features](#protocol-features)
  * [OAuth Handling](#oauth-handling)
  * [Transport Types](#transport-types)
  * [Connection Type](#connection-type)
  * [Logging Level Control](#logging-level-control)
  * [Copy Server configuration](#copy-server-configuration)
  * [Custom Auth-related properties](#custom-auth-related-properties)
  * [Timeout management](#timeout-management)
  * [Schema parsing for Elicitation, Tool Input Schemas](#schema-parsing-for-elicitation-tool-input-schemas)
  * [Form inputs vs JSON editor for:](#form-inputs-vs-json-editor-for)
  * [Proxy server](#proxy-server)
  * [Previous Security Fixes](#previous-security-fixes)
  * [Server file maintenance](#server-file-maintenance)
  * [Plugin architecture](#plugin-architecture)

## Protocol Features
  * Tools  
  * Resources  
  * Resource Subscriptions  
  * Resource Templates  
  * Prompts  
  * Elicitation  
  * Sampling with stubbed response  
  * Roots  
  * Logging  
  * Completions  
  * Metadata  
  * Pagination  
    * resources/list  
    * resources/templates/list  
    * prompts/list  
    * tools/list  
  * Cancellation (of in progress requests)  
  * Ping  

## OAuth Handling
  * Quick Flow  
  * Guided Flow  
  * Basic (non debugger) Flow  

## Transport Types
  * STDIO  
  * SSE  
  * SHTTP  

## Connection Type
  * Direct   
  * Via Proxy  

## Logging Level Control
  * Present and synchronized when connecting to server with logging capability  

## Copy Server configuration
  * As config file server entry  
  * As config file containing server entry  

## Custom Auth-related properties
* Custom headers
* Client ID
* Secret
* Scope  

## Timeout management
  * Request timeout  
  * Request timeout on progress (bool)  
  * Maximum total timeout  

## Schema parsing for Elicitation, Tool Input Schemas
  * New enum types
  * anyOf  /oneOf  
  * $ref  
  * $defs

## Form inputs vs JSON editor for:
  * Elicitation, tool input, resource template, and prompt vars, sampling response
  * Field types of primitive, object, array  
  * Nullable field types   
  * Defaults  

## Proxy server
  * Required for testing STDIO servers and HTTP servers that can’t open up their CORS origin for testing  
  * Implement a feature configuration file rather than disparate environment variables for everything  
  * Handle auth flows instead of browser when "via proxy" connection type selected

## Previous Security Fixes
  * Unique proxy server session token to prevent unauthorized access to the proxy server's ability to execute local processes and connect to MCP servers.  
  * Bind to localhost by default to prevent DNS rebinding attacks (never 0.0.0.0)  
  * Fix/validate redirect urls for http/https scheme only in auth flow

## Server file maintenance
  * Opening screen similar to MCPJam servers list  
  * Adding, changing, and deleting a server would hit endpoints on the proxy server update the inspector’s servers.json config file

## Plugin architecture
  * Allow third parties to extend the Inspector with functionality we do not wish to maintain, but which would still be useful to developers within the context of the Inspector, e.g., LLMs, evals, OpenAI Apps SDK playground  
