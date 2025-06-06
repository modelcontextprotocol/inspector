<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/MCPJam/inspector/blob/main/client/public/mcp_jam_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/MCPJam/inspector/blob/main/client/public/mcp_jam_light.png">
  <img width="250" alt="MCPJam logo" src="https://github.com/MCPJam/inspector/blob/main/client/public/mcp_jam_light.png">
</picture>

<br/>

# MCPJam Inspector

**The developer tool for testing and debugging MCP servers**

[![npm version](https://img.shields.io/npm/v/@mcpjam/inspector?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@mcpjam/inspector)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=for-the-badge)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/Node.js-22.7.5+-green.svg?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/yF7vWWkk)

</div>

---

## Quick Start

Get up and running in seconds with the MCPJam Inspector:

```bash
npx @mcpjam/inspector@latest
```

That's it! The inspector will launch automatically in your browser at `http://localhost:6274`.

---

## 📸 Screenshots

<div align="center">
<img width="1511" alt="MCPJam Inspector Interface" src="https://github.com/user-attachments/assets/ade8a46a-f738-4d32-ac85-260a5e22b90f" />
</div>

---

## ✨ Core Features

This project is a fork of the [@modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector). Many of the features are the same but with some enhancements. Key features include:

- **STDIO / SSE / Streamable HTTP** - This inspector supports all three protocols. Connect to any MCP server.
- **Tool Execution** - Run server tools with live parameter input. Easily debug errors.
- **(New) LLM tool interaction** - Test your MCP server against a real LLM.
- **Debugging tools** - Enhanced logging experience to debug your server.
- **Quality of life improvements** - Save requests, multi-server connection, saved connections.

## 📋 Requirements

- **Node.js**: `^22.7.5` or higher
- **npm**: `^10.0.0` or higher (comes with Node.js)

---

## 🎯 Usage Examples

### Basic Usage

```bash
# Launch inspector with default settings
npx @mcpjam/inspector
```

### Connect to Local Server

```bash
# Connect to a server built at build/index.js
npx @mcpjam/inspector node build/index.js
```

### Connect with Arguments

```bash
# Pass custom arguments to your server
npx @mcpjam/inspector node server.js --port 3000 --debug
```

### Using Configuration File

```bash
# Load servers from a config file
npx @mcpjam/inspector --config ./my-config.json
```

### Example Configuration File

```json
{
  "mcpServers": {
    "my-awesome-server": {
      "command": "node",
      "args": ["build/index.js"],
      "env": {
        "API_KEY": "your-api-key",
        "DEBUG": "true"
      }
    },
    "python-server": {
      "command": "python",
      "args": ["-m", "my_mcp_server"],
      "env": {
        "PYTHONPATH": "./src"
      }
    }
  }
}
```

---

## 🏗️ Architecture

The MCPJam Inspector is built as a modern monorepo with three main components:

```
📦 @mcpjam/inspector
├── 🖥️  client/     # React + TypeScript frontend
├── 🔧  server/     # Express.js backend with WebSocket support
└── 🚀  cli/        # Command-line interface
```

### Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Radix UI
- **Backend**: Express.js, WebSocket (ws), CORS support
- **CLI**: Node.js with shell integration
- **Build Tools**: Vite, TSC, Concurrently

---

## 🛠️ Development

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/mcpjam/inspector.git
cd inspector

# Install dependencies
npm install

# Start development servers
npm run dev
```

### Build for Production

```bash
# Build all components
npm run build

# Test the build
npm run start
```

### Scripts for development

We put together these commands to help you build locally:
| Script | Description |
| ---------------------- | ------------------------------------------- |
| `npm run dev` | Start development servers (client + server) |
| `npm run build` | Build all components for production |
| `npm run test` | Run test suite |
| `npm run prettier-fix` | Format code with Prettier |
| `npm run clean` | Clean all build artifacts and reinstall |

---

## 🤝 Contributing

We welcome contributions! We thought the original inspector repository moved too slowly, so we wanted to build this project ourselves.

1. **Clone** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

## 🗺️ Our Roadmap

We're continuously improving the MCPJam Inspector. Here's what's coming next:

### UI/UX Improvements

- **Fix dark mode styling** - Improve run tool button appearance in dark mode
- **Enhanced logging UX** - Address misleading red color for INFO logs

### Core Features

- **AI parameter fill** - Smart parameter completion using AI
- **Collections** - Organize and group your MCP servers / tools
- **Multi Provider support** - Support for other LLMs like ChatGPT

### Technical Enhancements

- **Security scanning** - Built-in vulnerability scanning tools
- **Electron App** - Desktop application for enhanced user experience

### Ecosystem

- **Landing page improvements** - Update MCP Jam landing page
- **Documentation expansion** - Enhanced guides and tutorials

### Development Guidelines

- Follow the existing code style (Prettier + ESLint)
- Update documentation as needed

---

## 📚 Resources

- **🌐 Website**: [mcpjam.com](https://mcpjam.com)
- **📖 Documentation**: [MCP Protocol Docs](https://modelcontextprotocol.io/)
- **🐛 Issues**: [GitHub Issues](https://github.com/mcpjam/inspector/issues)
- **💬 Discussions**: [GitHub Discussions](https://github.com/mcpjam/inspector/discussions)

---

## 📄 License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Made with ❤️ by the [MCPJam](https://mcpjam.com) team**

</div>
