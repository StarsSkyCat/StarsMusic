import { KugouService } from '../../packages/providers/src/kugou/service';
import { normalizeError } from '../../packages/contracts/src/errors';
import { record, text, nonNegativeInteger } from '../../packages/contracts/src/validation';
import { kugouId } from '../../packages/contracts/src/kugou';

// 凭据只存在此 utilityProcess 的临时内存；不写文件，不输出原始响应。
const service = new KugouService();
const port = process.parentPort;
service.subscribe((state) => port.postMessage({ kind: 'state', state }));
port.on('message', (event) => {
  void (async () => {
    let requestId = 0;
    try {
      const message = record(event.data as unknown, 'provider.message');
      requestId = nonNegativeInteger(message.requestId, 'provider.requestId');
      const operation = text(message.operation, 'provider.operation');
      let result: unknown;
      if (operation === 'getState') result = service.snapshot();
      else if (operation === 'startLogin') result = await service.startLogin();
      else if (operation === 'cancelLogin') result = service.cancelLogin();
      else if (operation === 'logout') result = service.logout();
      else if (operation === 'loadPlaylists') result = await service.loadPlaylists();
      else if (operation === 'loadPlaylist') result = await service.loadPlaylist(kugouId(message.id), nonNegativeInteger(message.offset, 'provider.offset'));
      else if (operation === 'resolveTrack') result = await service.resolveTrack(kugouId(message.id), nonNegativeInteger(message.generation, 'provider.generation'));
      else throw new Error('unknown operation');
      port.postMessage({ kind: 'reply', requestId, ok: true, result });
    } catch (error: unknown) { port.postMessage({ kind: 'reply', requestId, ok: false, error: normalizeError(error) }); }
  })();
});
process.on('uncaughtException', () => process.exit(1));
process.on('unhandledRejection', () => process.exit(1));
port.postMessage({ kind: 'ready' });
