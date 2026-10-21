import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function installRuntimeDiagnostics(rootDir, runtime = process) {
  const directory = path.join(rootDir, 'data', 'runtime');
  function record(event, details = {}) {
    const entry = {
      at: new Date().toISOString(), pid: runtime.pid, event,
      ...(Number.isInteger(details.port) ? { port: details.port } : {}),
      ...(Number.isInteger(details.exitCode) ? { exitCode: details.exitCode } : {}),
      ...(details.errorType ? { errorType: details.errorType } : {}),
      ...(details.errorCode ? { errorCode: details.errorCode } : {}),
      ...(details.origin ? { origin: details.origin } : {}),
      ...(details.locations ? { locations: details.locations } : {}),
    };
    try {
      mkdirSync(directory, { recursive: true });
      appendFileSync(path.join(directory, 'server.log'), `${JSON.stringify(entry)}\n`);
    } catch {
      // A diagnostic write failure must not interrupt product operations.
    }
  }

  runtime.on('uncaughtExceptionMonitor', (error, origin) => {
    const stack = String(error?.stack || '');
    const heading = `${error?.name || 'Error'}${error?.message ? `: ${error.message}` : ''}`;
    const frames = (stack.startsWith(heading) ? stack.slice(heading.length) : '')
      .split('\n').filter((line) => /^\s+at\s/.test(line)).join('\n');
    const locations = [...frames.matchAll(/[\\/](src[\\/][A-Za-z0-9_.\\/-]+:\d+:\d+)/g)]
      .slice(0, 12).map((match) => match[1].replaceAll('\\', '/'));
    record('fatal', {
      errorType: /^[A-Za-z]+Error$/.test(error?.name) ? error.name : 'Error',
      errorCode: /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code) ? error.code : undefined,
      origin: origin === 'unhandledRejection' ? origin : 'uncaughtException',
      locations,
    });
  });
  runtime.on('exit', (exitCode) => record('exit', { exitCode }));
  record('start');
  return { record };
}
