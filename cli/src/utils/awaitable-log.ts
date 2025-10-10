export function awaitableLog(logValue: string): Promise<void> {
  return new Promise<void>((resolve) => {
    process.stdout.write(logValue, () => {
      resolve();
    });
  });
}
