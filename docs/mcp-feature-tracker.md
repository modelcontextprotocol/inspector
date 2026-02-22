# MCP Feature Implementation Across Projects

Track MCP feature support across InspectorClient, Web v1, Web v1.5, and TUI.

| Feature                                    | InspectorClient | Web v1  | Web v1.5 | TUI |
| ------------------------------------------ | --------------- | ------- | -------- | --- |
| **Resources**                              |                 |         |          |     |
| List resources                             | ✅              | ✅      | ✅       | ✅  |
| Read resource content                      | ✅              | ✅      | ✅       | ✅  |
| List resource templates                    | ✅              | ✅      | ✅       | ✅  |
| Read templated resources                   | ✅              | ✅      | ✅       | ✅  |
| Resource subscriptions                     | ✅              | ✅      | ✅       | ❌  |
| Resources listChanged notifications        | ✅              | ✅      | ✅       | ❌  |
| Pagination (resources)                     | ✅              | ✅      | ✅       | ✅  |
| Pagination (resource templates)            | ✅              | ✅      | ✅       | ✅  |
| **Prompts**                                |                 |         |          |     |
| List prompts                               | ✅              | ✅      | ✅       | ✅  |
| Get prompt (no params)                     | ✅              | ✅      | ✅       | ✅  |
| Get prompt (with params)                   | ✅              | ✅      | ✅       | ✅  |
| Prompts listChanged notifications          | ✅              | ✅      | ✅       | ❌  |
| Pagination (prompts)                       | ✅              | ✅      | ✅       | ✅  |
| **Tools**                                  |                 |         |          |     |
| List tools                                 | ✅              | ✅      | ✅       | ✅  |
| Call tool                                  | ✅              | ✅      | ✅       | ✅  |
| Tools listChanged notifications            | ✅              | ✅      | ✅       | ❌  |
| Pagination (tools)                         | ✅              | ✅      | ✅       | ✅  |
| **Roots**                                  |                 |         |          |     |
| List roots                                 | ✅              | ✅      | ✅       | ❌  |
| Set roots                                  | ✅              | ✅      | ✅       | ❌  |
| Roots listChanged notifications            | ✅              | ✅      | ✅       | ❌  |
| **Authentication**                         |                 |         |          |     |
| OAuth 2.1 flow                             | ✅              | ✅      | ✅       | ✅  |
| OAuth: Static/Preregistered clients        | ✅              | ✅      | ✅       | ✅  |
| OAuth: DCR (Dynamic Client Registration)   | ✅              | ✅      | ✅       | ✅  |
| OAuth: CIMD (Client ID Metadata Documents) | ✅              | ❌      | ✅       | ✅  |
| OAuth: Guided Auth (step-by-step)          | ✅              | ✅      | ✅       | ✅  |
| Custom headers                             | ✅ (config)     | ✅ (UI) | ✅ (UI)  | ❌  |
| **Advanced Features**                      |                 |         |          |     |
| Sampling requests                          | ✅              | ✅      | ✅       | ❌  |
| Sampling with tools                        | ❌              | ❌      | ❌       | ❌  |
| Elicitation requests (form)                | ✅              | ✅      | ✅       | ❌  |
| Elicitation requests (url)                 | ✅              | ❌      | ❌       | ❌  |
| Tasks (long-running operations)            | ✅              | ✅      | ✅       | ❌  |
| Requestor task support                     | ✅              | ✅      | ✅       | ❌  |
| Completions (resource templates)           | ✅              | ✅      | ✅       | ❌  |
| Completions (prompts with params)          | ✅              | ✅      | ✅       | ❌  |
| Progress tracking                          | ✅              | ✅      | ✅       | ❌  |
| **Other**                                  |                 |         |          |     |
| HTTP request tracking                      | ✅              | ❌      | ✅       | ✅  |
