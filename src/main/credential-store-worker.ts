import { parentPort, workerData } from 'node:worker_threads';
import {
  parseStoredCredentials,
  SqliteCredentialStore,
} from '../../packages/storage/src/credential-store.ts';

if (!parentPort || typeof workerData?.file !== 'string') throw new Error('vault.worker-invalid');
const port = parentPort;
const store = new SqliteCredentialStore(workerData.file);
let queue = Promise.resolve();
port.on('message', (value: unknown) => {
  queue = queue
    .then(async () => {
      if (typeof value !== 'object' || value === null) return;
      const message = value as Record<string, unknown>;
      if (!Number.isSafeInteger(message.id)) return;
      try {
        let result;
        if (message.operation === 'read') result = await store.read();
        else if (message.operation === 'write')
          await store.write(parseStoredCredentials(message.value));
        else if (message.operation === 'reset') await store.reset();
        else if (message.operation === 'close') await store.close();
        else throw new Error('vault.operation-invalid');
        port.postMessage({ id: message.id, ok: true, result });
        if (message.operation === 'close') port.close();
      } catch {
        port.postMessage({ id: message.id, ok: false });
      }
    })
    .catch(() => undefined);
});
