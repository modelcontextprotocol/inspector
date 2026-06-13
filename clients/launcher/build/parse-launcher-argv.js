export const LAUNCHER_MODE_FLAGS = new Set(["--web", "--cli", "--tui"]);
/**
 * Launcher mode flags are read only from a contiguous prefix of user args
 * (argv[2…]). Everything after the first non-mode token is forwarded
 * unchanged so values like `--cli` can appear in app/server config.
 */
export function parseLauncherArgv(argv) {
    const executable = argv.slice(0, 2);
    const userArgs = argv.slice(2);
    const prefixFlags = [];
    let index = 0;
    while (index < userArgs.length && LAUNCHER_MODE_FLAGS.has(userArgs[index])) {
        prefixFlags.push(userArgs[index]);
        index++;
    }
    if (prefixFlags.length > 1) {
        throw new Error("Specify at most one of --web, --cli, or --tui.");
    }
    const mode = prefixFlags[0] === "--tui"
        ? "tui"
        : prefixFlags[0] === "--cli"
            ? "cli"
            : "web";
    return {
        mode,
        forwardedArgv: [...executable, ...userArgs.slice(index)],
        hasPrefixModeFlag: prefixFlags.length > 0,
    };
}
