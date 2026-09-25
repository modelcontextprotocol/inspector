# Where secrets are stored

The Inspector keeps a few values out of `mcp.json`, `client.json` and `oauth.json` and puts them in a **secret store** instead. This guide explains which store you get, why, where it lives, and how to change it. It applies to every runtime: a desktop install, a Linux server or SSH session, Android/Termux, and a container. For the container-specific parts (volumes, ownership), also read the [Docker guide](./docker.md).

## What counts as a secret

These values are stored as secrets:

| Value                             | Saved from                             |
| --------------------------------- | -------------------------------------- |
| A server's OAuth client secret    | The server's OAuth settings            |
| The enterprise IdP client secret  | Client Settings (install-level)        |
| Each stdio server's `env:` value  | A stdio server's environment variables |
| Acquired OAuth tokens (access, refresh, ID) | Completing an OAuth flow     |
| IdP session tokens (enterprise-managed auth) | Completing an IdP login     |
| Dynamically registered client secrets | DCR during an OAuth flow          |

They are kept out of `mcp.json` so that sharing, committing or syncing the file does not leak credentials (#1356). When the Inspector saves an entry to a durable store, it leaves each `env` key in `mcp.json` with an empty value and omits the client secret; the real values live in the store. `headers` are **not** moved: they are saved in `mcp.json` exactly as written, so a header that carries a credential stays in the file. [MCP server configuration](./mcp-server-configuration.md) describes what that means for other tools reading the same file.

Acquired tokens follow the same rule for the OAuth state file: `oauth.json` keeps only non-secret state (flow bookkeeping, discovered metadata, public client ids), and the tokens and client secrets it used to hold live in the secret store. A pre-existing `oauth.json` that still carries plaintext tokens is migrated on first read — the tokens move into the store and the file is rewritten without them — but only when the store is durable; under the `memory` store the file is left as-is, since it is still the only durable copy. `MCP_INSPECTOR_PERSIST_TOKENS=all|access|none` controls which acquired tokens are persisted at all (see [Environment variables](./environment-variables.md#secret-store)).

## How the store is chosen

Each process picks one store, once, the first time it needs it: the web backend at startup, the CLI and TUI on their first access to a secret. Every client (web, CLI and TUI) goes through the same selection, in this order:

1. **`MCP_INSPECTOR_SECRET_STORE`**, if it is `keyring`, `file` or `memory` (case-insensitive). That store is used and nothing is probed. An empty or whitespace-only value counts as unset. Any other value is ignored with a warning, and selection continues as if it were unset.
2. **The OS keychain**, if a probe can reach it: Keychain on macOS, Credential Manager on Windows, and the Secret Service (libsecret, for example GNOME Keyring or KWallet) on Linux. Entries are stored under the service name `mcp-inspector`. Most desktop installs stop here.
3. **A fallback**, when the probe fails. The Inspector says so on stderr when it selects the store, and names the store it picked (see [Where the active store is reported](#where-the-active-store-is-reported)):
   - `memory` if it is running in a container **and** the directory the secrets file would go in is not on a mounted volume, because a file in a container's writable layer is lost on `docker run --rm` and on every image update;
   - `file` everywhere else.

The probe requires the keychain to both **read** and **enumerate** entries. On Linux the two can come from different providers: single entries can be served from the kernel keyring (keyutils) without a Secret Service, but enumeration — which deleting a server's credentials depends on — needs the Secret Service itself. A host with only the kernel keyring therefore falls back exactly like a host with no keychain at all. Earlier releases probed reads only and selected the keychain on such hosts; anything they stored lives in kernel memory only (it never survives a reboot) and is not read by the fallback store. To keep using those entries for the remainder of the boot session, set `MCP_INSPECTOR_SECRET_STORE=keyring`.

| Where you run it                                                        | Store                               | Secrets survive a restart? |
| ----------------------------------------------------------------------- | ----------------------------------- | -------------------------- |
| Desktop macOS or Windows, or Linux with a Secret Service running        | OS keychain                         | Yes                        |
| Linux without libsecret or a Secret Service                             | File (`secrets.json`, mode `0600`)  | Yes                        |
| Headless server or SSH session with no D-Bus session                    | File                                | Yes                        |
| Android/Termux                                                          | File                                | Yes                        |
| Container with **no volume** on the secrets directory                   | Memory                              | No, this session only      |
| Container **with** a volume on the secrets directory                    | File                                | Yes                        |
| Any of the above with `MCP_INSPECTOR_SECRET_STORE` set                  | The store you named                 | Not with `memory`; with `file` in a container, only if the file is on a volume |

> [!WARNING]
> **With no keychain, secrets go to a plaintext file, and you did not have to ask for it.** On a host where the keychain probe fails (Linux without libsecret or a running Secret Service such as GNOME Keyring or KWallet, a headless server or SSH session with no D-Bus session, or Android/Termux), the Inspector falls back **automatically** to `~/.mcp-inspector/secrets.json`. Unless you supply a key, that file is **unencrypted**. Mode `0600` keeps out other non-root users, but not root, not backups or copies of your home directory, and not any program running as you. The only signs are a warning on stderr when the store is selected and the footer in the web settings dialogs.
>
> Pick one:
>
> - **Get a keychain back**: install libsecret and run a Secret Service (for example `gnome-keyring`), or run the Inspector inside a desktop session. On the next start the Inspector moves the file's secrets into the keychain and deletes the file ([details](#getting-a-keychain-back)).
> - **Encrypt the file**: supply a generated key with `MCP_INSPECTOR_SECRET_KEY_FILE` (preferred) or `MCP_INSPECTOR_SECRET_KEY` ([details](#encryption)).
> - **Don't write secrets to disk at all**: `MCP_INSPECTOR_SECRET_STORE=memory`, and re-enter them each session.
>
> Even encrypted, secrets on disk carry moderate risk. See [what the file store protects against](#what-the-file-store-protects-against).

The Inspector decides that it is in a container from `KUBERNETES_SERVICE_HOST`, Docker's `/.dockerenv`, Podman's `/run/.containerenv`, or the process's cgroup. The container check only chooses between `memory` and `file`; the mount check is what actually decides.

The choice is made once per process. Installing a keychain while the Inspector is running takes effect on the next start.

### The memory store

`memory` keeps secrets for this process only; nothing is written anywhere and they are gone when it exits. Because it is not durable, the Inspector does **not** remove plaintext values that are already in `mcp.json`, `client.json` or `oauth.json` while it is active: in that case the file on disk is still the durable copy — including pre-existing OAuth tokens, which keep working across runs until a save changes or removes them. New or changed values are still kept out of the file, so a token *acquired or refreshed* under the memory store lasts this session only and needs a re-auth next run.

## The file store

### Where the file is

The path is the first of these that applies:

1. `MCP_INSPECTOR_SECRET_FILE`, if set;
2. `secrets.json` inside `MCP_STORAGE_DIR`, if that is set;
3. `~/.mcp-inspector/secrets.json`.

⚠️ The default sits **beside** the default storage directory (`~/.mcp-inspector/storage`), not inside it. Setting `MCP_STORAGE_DIR` moves the secrets file together with the OAuth state (`oauth.json`), for every client. It also moves `client.json` for the **web** backend only; the CLI and TUI find `client.json` through `MCP_CLIENT_CONFIG_PATH` instead.

### Encryption

**A file store is unencrypted unless you give it a passphrase.** Set `MCP_INSPECTOR_SECRET_KEY`, or point `MCP_INSPECTOR_SECRET_KEY_FILE` at a file containing it, and the file is encrypted with AES-256-GCM, with the passphrase stretched by scrypt against a random salt that is regenerated on every write. Without it, the file is still mode `0600`, but anyone who can read the file can read the values. The startup log and the settings footer say so every session, as a warning.

**Use a high-entropy passphrase: generate it, don't choose it.** The random salt stops an attacker from precomputing a table, but it does nothing against guessing. The scrypt cost is deliberately low because the derivation runs on every read and write. Anyone who obtains `secrets.json` can therefore test candidate passphrases quickly and offline, so treat this value like any other credential, not like a memorable password.

**Prefer the key file.** `MCP_INSPECTOR_SECRET_KEY_FILE` reads the passphrase from a file, with trailing line breaks removed, so it never has to sit in the environment, a shell profile, an `.env` file or a Compose file. It is the variable Docker and Compose secrets are built for (see the [Docker guide](./docker.md)). Setting a non-blank `MCP_INSPECTOR_SECRET_KEY` together with `MCP_INSPECTOR_SECRET_KEY_FILE` is an error; a blank `MCP_INSPECTOR_SECRET_KEY` still counts as unset, so the key file is used. Setting `MCP_INSPECTOR_SECRET_KEY_FILE` to an empty value is also an error: unlike an empty `MCP_INSPECTOR_SECRET_KEY`, which switches encryption off, it is taken as a key file that failed to arrive. If the key file is missing, unreadable or empty, the variable is blank, or both are set, the file store **refuses to read or write** instead of falling back to plaintext: saves fail, and the startup warning and settings footer report the file as unreadable, with the reason.

**Adding a passphrase later is safe.** The next write upgrades an existing plaintext file in place. Until that write happens the existing values are still readable, and the banner and footer keep saying so. They do not report the file as encrypted just because the variable is now set.

**Changing or losing the passphrase is not safe.** A file that can no longer be decrypted is read as empty, and the Inspector **refuses to write to it** rather than replacing it with a new file that holds only your latest secret. To recover, restore the original passphrase, or delete the secrets file at its configured path (see [Where the file is](#where-the-file-is); the path is also shown in the startup warning and the settings footer) and enter the values again.

### Permissions

The Inspector writes the file with mode `0600` and tightens it again when the store is selected if something loosened it. If it _cannot_ tighten it (the file belongs to another user, or the mount is read-only), it says so in the log and the footer instead of continuing to describe the file as protected.

### What the file store protects against

The file store is a fallback for machines without a keychain, and it is weaker than a keychain. Treat keeping secrets in it, even encrypted, as a **moderate risk**. Here is what it does and does not defend against.

**Without a passphrase (plaintext, mode `0600`):**

- ✅ Other non-root users on the same machine, as long as the mode holds.
- ❌ Root, and on a container host, every member of the `docker` group, which is equivalent to root.
- ❌ Anyone who gets a copy of the file: a backup, a disk or volume snapshot, a synced home directory, or an accidental `git add` of a bind-mounted directory.
- ❌ Any program running as your user, including the stdio MCP servers the Inspector starts.

**With `MCP_INSPECTOR_SECRET_KEY` set (AES-256-GCM):**

- ✅ **The file leaking on its own.** A backup, snapshot, copy or commit of `secrets.json` is useless without the key, _provided_ the passphrase is high-entropy (see [Encryption](#encryption)) and the key did not leak with it. This is the threat encryption at rest is for.
- ❌ **Anyone who can read the key where it lives.** With `MCP_INSPECTOR_SECRET_KEY` the key is in the Inspector's environment, readable through `/proc/<pid>/environ` by the same user or root, through `docker inspect` and `docker exec` for a container, and wherever you stored it for launching, such as a shell profile, an `.env` file or a Compose file. `MCP_INSPECTOR_SECRET_KEY_FILE` narrows this to whoever can read the key file, but the Inspector must be able to read it, so the same user can too. If the key sits next to the secrets file (in the same backup, volume or repository), encryption buys nothing.
- ❌ **Root on the host, or the `docker` group.** They can read both the file and the key, or the process memory holding the decrypted values.
- ❌ **Code running as the same user.** The Inspector does **not** pass its own environment to the stdio servers it starts: they get a short allowlist (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER` on macOS and Linux) plus their configured `env:`. But a server runs as the same user, so it can open the secrets file directly and can usually read the Inspector's environment through `/proc`. Only run servers you would trust with these secrets.
- ❌ **A weak passphrase.** Anyone with the file can guess offline.

In short, encryption turns "the file leaked" into "the file **and** the key leaked". It does not help against anyone who already has access to the machine or the container as root, or as the user the Inspector runs as. When that is not acceptable, use a keychain (install libsecret or run a Secret Service on Linux), or `MCP_INSPECTOR_SECRET_STORE=memory` and re-enter secrets each session.

### Two Inspectors, one file

Within a process, changes are serialized per file path, so a web session's own concurrent saves cannot overwrite each other. Across processes, for example a CLI run next to a web session, each change takes an exclusive lock on `<secrets-file>.lock`, a lock directory beside the secrets file named after it (`secrets.json.lock` by default), for the whole read-modify-write. The lock uses [`proper-lockfile`](https://github.com/moxystudio/node-proper-lockfile), the same library npm uses for its own locks. The lock expires 10 seconds after its holder stops refreshing it, so an Inspector that is killed mid-save does not leave the file unwritable.

So two running Inspectors are genuinely serialized. What a lock file cannot make single-winner is the _takeover of a lock whose holder died_. That needs a compare-and-swap on a directory entry (`renameat2`), which Node does not expose, and `proper-lockfile` does not close that race either. The window only opens after a holder dies without releasing its lock.

The Inspector adds one check on top. Every lock-directory removal the library makes on its behalf, on release and from its exit handler, first checks that the directory is still the one it created (by inode and birth time, which survive the library's own refresh but not a delete-and-recreate). Without that check the removals are unconditional, so a holder whose lock had been replaced would delete the _winner's_ lock on the way out, turning one compromised writer into two unprotected ones. The check also reports the takeover as a warning. Treat all of this as **best-effort**: the check is still followed by a separate act, so it makes the destructive case rare rather than impossible, and it relies on filesystem metadata that not every filesystem reports.

That is why, under the lock, each change still reads the file, applies the change, writes, then reads back and compares the whole map. If something wrote in between, it re-applies the change to what is there now and retries, and it fails loudly after five lost rounds instead of reporting the value as saved. That check catches a clobber inside the takeover window. It also covers writers that no lock can order, because a lock only orders the writers that _take_ it: an editor, a restored backup, or an older Inspector.

If another process holds the lock and does not release it, the save **fails** rather than going ahead unlocked. It waits past the stale window first, so a crashed Inspector clears itself instead of failing everyone else's saves. When there is another writer you can see, writing anyway is the one case where continuing would lose the secret the save was meant to protect.

The same read-back check covers a lock that cannot be taken at all. The file store exists for machines where the usual mechanism is missing, so when a directory cannot hold a lock file (a read-only `$HOME`, or a mount owned by another uid), the save goes ahead unlocked with a warning. Otherwise every save would fail on exactly the setups this store was written for.

## Getting a keychain back

If you install libsecret (or start a Secret Service) on a machine that was using the file store, the next start probes successfully, selects the keychain, and **moves the contents of `secrets.json` into it**:

- **The keychain wins on conflict.** A value already in the keychain is kept and the file's value is not copied, because it is treated as the older copy. Only entries the keychain does not have are written.
- **The file is removed only when every entry is accounted for**, meaning each one either was already in the keychain or was written there. If any entry could not be handled, or a keychain read or write fails, the file is left as it was and the next start tries again. A file with no entries is also left in place.
- **An unreadable file is not deleted.** If the file cannot be decrypted (the passphrase changed or is now unset), the Inspector reports it and leaves the file in place.

A successful move prints a message naming the file it removed. The same hand-off runs when you select the keychain explicitly with `MCP_INSPECTOR_SECRET_STORE=keyring`. It does not run in the other direction: choosing `file` or `memory` does not copy anything out of the keychain.

## Where the active store is reported

- **When the store is selected** (at startup for the web backend, on first use for the CLI and TUI), every client prints a warning on stderr if it falls back from the keychain, including the keychain error, and another if the file is unencrypted, has loose permissions, or cannot be read. Either warning is followed by a link to this guide. The web client's startup banner also has a `Secrets:` line on every run.
- **`GET /api/config`** (web) includes a `secretStorage` object describing the active store.
- **In the web UI**, a footer at the bottom of the **Client Settings**, **Server Settings** and **Add / Edit / Clone server** dialogs names the store, and turns into a warning when it is memory-only, unencrypted, loosely permissioned, or unreadable. It is shown where you type a secret, not only once at startup.

## Changing the store

| To                                         | Set                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Always use the keychain                    | `MCP_INSPECTOR_SECRET_STORE=keyring`                                 |
| Use a file even though a keychain exists   | `MCP_INSPECTOR_SECRET_STORE=file`                                    |
| Never write secrets to disk                | `MCP_INSPECTOR_SECRET_STORE=memory`                                  |
| Put the file somewhere else                | `MCP_INSPECTOR_SECRET_FILE=/path/to/secrets.json`, or `MCP_STORAGE_DIR` |
| Encrypt the file                           | `MCP_INSPECTOR_SECRET_KEY_FILE=/path/to/key-file` (preferred), or `MCP_INSPECTOR_SECRET_KEY=<generated passphrase>` |

Every variable is also listed in [Environment variables](./environment-variables.md#secret-store).
