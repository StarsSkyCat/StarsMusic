import { parseStoredPlaybackTrack } from '../../packages/contracts/src/playback-session';
import { DomainError } from '../../packages/contracts/src/errors';
import { KugouService } from '../../packages/providers/src/kugou/service';
import { normalizeError } from '../../packages/contracts/src/errors';
import { record, text, nonNegativeInteger } from '../../packages/contracts/src/validation';
import { kugouId } from '../../packages/contracts/src/kugou';

// 平台凭据只在可信后台流转；主进程负责解密/加密，SQLite 仅保存密文。
const port = process.parentPort;
const service = new KugouService({ onCredentials: (credentials) => port.postMessage({ kind: 'credentials', credentials }) });
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
      else if (operation === 'restoreCredentials') result = await service.restoreCredentials(message.credentials);
      else if (operation === 'exportCredentials') result = service.exportCredentials() ?? null;
      else if (operation === 'getPresentation') result = await service.getPresentation(kugouId(message.id), nonNegativeInteger(message.generation, 'provider.generation'));
      else if (operation === 'ensureRestoredTrack') {
        const track = parseStoredPlaybackTrack(message.track);
        if (track.kind === 'local') throw new DomainError('invalid-input');
        await service.ensureRestoredTrack(track, nonNegativeInteger(message.generation, 'provider.generation'));
      }
      else if (operation === 'resolveTrack') result = await service.resolveTrack(kugouId(message.id), nonNegativeInteger(message.generation, 'provider.generation'));
      else throw new Error('unknown operation');
      port.postMessage({ kind: 'reply', requestId, ok: true, result });
    } catch (error: unknown) { port.postMessage({ kind: 'reply', requestId, ok: false, error: normalizeError(error) }); }
  })();
});
process.on('uncaughtException', () => process.exit(1));
process.on('unhandledRejection', () => process.exit(1));
port.postMessage({ kind: 'ready' });
