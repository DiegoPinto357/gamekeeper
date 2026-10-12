let installed = false;

export const installSqliteWarningSuppression = (): void => {
  if (installed) return;
  installed = true;

  const proc = process as unknown as {
    emit: (event: string | symbol, ...args: unknown[]) => boolean;
  };
  const originalEmit = proc.emit;

  proc.emit = (event, ...args): boolean => {
    if (event === 'warning') {
      const warning = args[0] as { name?: string; message?: string };
      if (
        warning?.name === 'ExperimentalWarning' &&
        typeof warning.message === 'string' &&
        warning.message.includes('SQLite')
      ) {
        return false;
      }
    }
    return originalEmit.call(process, event, ...args);
  };
};

installSqliteWarningSuppression();
