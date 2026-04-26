import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const longToolList: Tool[] = [
  {
    name: "read_file",
    title: "Read File",
    description:
      "Read the contents of a text file from the local filesystem. Returns the file's contents as a UTF-8 string along with metadata.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path" },
        encoding: {
          type: "string",
          enum: ["utf-8", "ascii", "latin1"],
          description: "Text encoding to use",
        },
      },
      required: ["path"],
    },
    outputSchema: {
      type: "object",
      properties: {
        contents: { type: "string" },
        bytes: { type: "number" },
      },
      required: ["contents", "bytes"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "write_file",
    title: "Write File",
    description:
      "Write the given contents to a file at the specified path, creating it if it does not exist.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Destination file path" },
        contents: { type: "string", description: "Text contents to write" },
        overwrite: {
          type: "boolean",
          description: "Allow overwriting an existing file",
        },
      },
      required: ["path", "contents"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "list_directory",
    title: "List Directory",
    description: "List the entries in a directory, optionally recursing.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to list" },
        recursive: { type: "boolean", description: "Recurse into subdirs" },
      },
      required: ["path"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "delete_file",
    title: "Delete File",
    description:
      "Delete a file from the filesystem. This action cannot be undone.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File to delete" },
      },
      required: ["path"],
    },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  {
    name: "search_files",
    title: "Search Files",
    description:
      "Search for files matching a glob pattern under the given root.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        pattern: { type: "string", description: "e.g. **/*.ts" },
        maxResults: { type: "number" },
      },
      required: ["root", "pattern"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "query_database",
    title: "Query Database",
    description:
      "Execute a read-only SQL query against the configured database connection.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SELECT statement" },
        params: {
          type: "array",
          description: "Positional bind parameters",
          items: {},
        },
        limit: { type: "number" },
      },
      required: ["sql"],
    },
    outputSchema: {
      type: "object",
      properties: {
        rows: { type: "array", items: { type: "object" } },
        rowCount: { type: "number" },
      },
      required: ["rows", "rowCount"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "insert_record",
    title: "Insert Record",
    description: "Insert a new record into the named table.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string" },
        values: { type: "object", description: "Column → value map" },
      },
      required: ["table", "values"],
    },
  },
  {
    name: "update_record",
    title: "Update Record",
    description: "Update an existing record by primary key.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string" },
        id: { type: "string" },
        values: { type: "object" },
      },
      required: ["table", "id", "values"],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: "delete_record",
    title: "Delete Record",
    description: "Delete a record from the named table by primary key.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string" },
        id: { type: "string" },
      },
      required: ["table", "id"],
    },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  {
    name: "get_schema",
    title: "Get Schema",
    description: "Return the schema definition for the named table or view.",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string" },
      },
      required: ["table"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "git_status",
    title: "Git Status",
    description: "Show the working tree status of the given repository.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
      },
      required: ["repoPath"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "git_commit",
    title: "Git Commit",
    description:
      "Create a new commit on the current branch with the given message.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        message: { type: "string" },
        files: { type: "array", items: { type: "string" } },
      },
      required: ["repoPath", "message"],
    },
  },
  {
    name: "git_push",
    title: "Git Push",
    description:
      "Push commits to the configured remote. Requires network access.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        remote: { type: "string" },
        branch: { type: "string" },
      },
      required: ["repoPath"],
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "git_log",
    title: "Git Log",
    description: "List recent commits on the current branch.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        limit: { type: "number" },
      },
      required: ["repoPath"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "git_diff",
    title: "Git Diff",
    description: "Show changes between commits, branches, or the working tree.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        ref: { type: "string", description: "Optional revision range" },
      },
      required: ["repoPath"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "fetch_url",
    title: "Fetch URL",
    description:
      "Issue an HTTP GET request and return the response body and headers.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        headers: { type: "object" },
      },
      required: ["url"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "post_request",
    title: "Post Request",
    description: "Send a JSON HTTP POST to the given URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        body: {},
        headers: { type: "object" },
      },
      required: ["url", "body"],
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "parse_html",
    title: "Parse HTML",
    description:
      "Parse an HTML document and return a structured representation.",
    inputSchema: {
      type: "object",
      properties: {
        html: { type: "string" },
        selector: {
          type: "string",
          description: "Optional CSS selector to scope the parse",
        },
      },
      required: ["html"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "send_email",
    title: "Send Email",
    description: "Send an email through the configured SMTP relay.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string" },
        attachments: { type: "array", items: { type: "string" } },
      },
      required: ["to", "subject", "body"],
    },
    annotations: { openWorldHint: true },
  },
  {
    name: "schedule_task",
    title: "Schedule Task",
    description:
      "Schedule a background task to run at the specified time or interval.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        cron: { type: "string", description: "Cron expression" },
        payload: { type: "object" },
      },
      required: ["name", "cron"],
    },
  },
];
