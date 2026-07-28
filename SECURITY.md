# Security Policy

Thank you for helping keep the Model Context Protocol and its ecosystem secure.

## Supported Versions

| Version | Package                                  | Support                                                 |
| ------- | ---------------------------------------- | ------------------------------------------------------- |
| **2.x** | `@modelcontextprotocol/inspector`        | ✅ Actively supported                                   |
| 1.x     | `@modelcontextprotocol/inspector`        | ⚠️ **Security fixes only**, published under `v1-latest` |
| 1.x     | `@modelcontextprotocol/inspector-client` | ⚠️ Security fixes only                                  |
| 1.x     | `@modelcontextprotocol/inspector-server` | ⚠️ Security fixes only                                  |
| 1.x     | `@modelcontextprotocol/inspector-cli`    | ⚠️ Security fixes only                                  |
| < 1.0.0 | any                                      | ❌ Unsupported                                          |

v2 ships as a **single** package — `@modelcontextprotocol/inspector`. The three
`inspector-client` / `inspector-server` / `inspector-cli` sub-packages exist only
on the v1 line and are deprecated.

v1 development happens on the `v1/main` branch and is limited to security fixes.
Those releases are published under the **`v1-latest`** dist-tag so they never
displace the current v2 release:

```bash
npm i @modelcontextprotocol/inspector@v1-latest
```

Everything else — features, bug fixes, improvements — lands in v2 only.

## Reporting Security Issues

If you discover a security vulnerability in this repository, please report it through
the [GitHub Security Advisory process](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
for this repository. Private vulnerability reporting is enabled, so this is the
fastest route to a maintainer.

Please **do not** report security vulnerabilities through public GitHub issues, discussions,
or pull requests.

Note that this repository does not accept pull requests from outside contributors
(see [CONTRIBUTORS.md](./CONTRIBUTORS.md)) — **this does not apply to security
reports**, which should always go through the advisory process above rather than
any public channel.

## What to Include

To help us triage and respond quickly, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Whether it affects v2, v1, or both
- Any suggested fixes (optional)
