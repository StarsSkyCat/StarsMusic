import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLrc } from '../../packages/providers/src/lyrics.ts';
import { artworkData, artworkUrl } from '../../packages/providers/src/artwork.ts';
import { activeLyricIndex, parsePresentationContent } from '../../packages/contracts/src/presentation.ts';
import { PresentationController } from '../../packages/playback/src/presentation.ts';
import { parsePlaybackSnapshot } from '../../packages/contracts/src/playback.ts';
import { getKugouLyrics } from '../../packages/providers/src/kugou/lyrics.ts';

const pause = () => new Promise<void>(done => setImmediate(done));
// 仅含合成歌词和图片头，不包含真实歌曲歌词、账号或媒体地址。
test('LRC 支持多时间标签、偏移、同刻合并，播放定位直接投影高亮行', () => {
  const rows = parseLrc('[ar:合成歌手]\n[offset:-100]\n[00:02.10]第二行\n[00:00.10][00:03.001]第一行\n[00:02.10]合成译文');
  assert.deepEqual(rows, [{ timeMs: 0, text: '第一行' }, { timeMs: 2000, text: '第二行\n合成译文' }, { timeMs: 2901, text: '第一行' }]);
  assert.equal(activeLyricIndex(rows, 2.5), 1);
  assert.equal(activeLyricIndex(rows, .3), 0);
  assert.equal(activeLyricIndex([{ timeMs: 500, text: '合成' }], .1), -1);
  assert.deepEqual(parseLrc('纯文本无时间轴'), []);
});

test('公开歌词封面投影丢弃额外字段，拒绝远端地址、SVG 和过长歌词', () => {
  assert.deepEqual(parsePresentationContent({ lyrics: [], token: 'synthetic' }), { lyrics: [] });
  for (const artwork of ['https://imge.kugou.com/test', 'data:image/svg+xml;base64,PHN2Zy8+']) assert.throws(() => parsePresentationContent({ lyrics: [], artwork }));
  assert.throws(() => parsePresentationContent({ lyrics: [{ timeMs: 10, text: '二' }, { timeMs: 1, text: '一' }] }));
  assert.equal(artworkUrl('http://imge.kugou.com/cover/{size}/test.jpg', 'kugou').href, 'https://imge.kugou.com/cover/400/test.jpg');
  for (const url of ['https://imge.kugou.com.evil.invalid/x', 'https://localhost/x', 'https://user@imge.kugou.com/x', 'https://p1.music.126.net/x']) assert.throws(() => artworkUrl(url, 'kugou'));
  assert.throws(() => artworkData(Buffer.from('<svg/>')));
  assert.match(artworkData(Buffer.from([255,216,255,1])), /^data:image\/jpeg;base64,/);
});

test('快速切歌与停止时丢弃旧歌词、旧封面和旧错误', async () => {
  let resolveOld!: (value: { lyrics: { timeMs: number; text: string }[] }) => void;
  let oldSignal: AbortSignal | undefined;
  const controller = new PresentationController(async (track, signal) => {
    if (track.id === 'old') { oldSignal = signal; return new Promise(done => { resolveOld = done; }); }
    return { lyrics: [{ timeMs: 0, text: '当前合成歌词' }] };
  });
  const state = (id: string, generation: number) => parsePlaybackSnapshot({ revision: generation, generation, status: 'loading', queue: [{ id, title: id, provider: 'kugou', sourceId: 'a'.repeat(32) }], currentIndex: 0, positionSeconds: 0, durationSeconds: 0, volume: 70 });
  controller.select(state('old', 1)); controller.select(state('new', 2));
  assert.equal(oldSignal?.aborted, true); await pause();
  resolveOld({ lyrics: [{ timeMs: 0, text: '迟到旧歌词' }] }); await pause();
  assert.equal(controller.snapshot().trackId, 'new');
  assert.equal(controller.snapshot().content?.lyrics[0]?.text, '当前合成歌词');
  controller.select(parsePlaybackSnapshot({ ...state('new', 3), status: 'idle' }));
  assert.equal(controller.snapshot().status, 'unavailable'); assert.equal(controller.snapshot().content, undefined);
  controller.dispose();
});

test('酷狗歌词按已登记 hash 查询，过滤其他曲目并以 LRC 下载，不公开 accesskey', async () => {
  const calls: string[] = [];
  const lyrics = await getKugouLyrics({ id: 'a'.repeat(32), name: '合成歌手 - 合成曲目', artists: ['合成歌手'], durationMs: 30000 }, new AbortController().signal,
    async (endpoint, params) => {
      calls.push(endpoint);
      if (endpoint === 'search') {
        assert.equal(params.hash, 'a'.repeat(32));
        return { candidates: [{ id: '1', accesskey: 'synthetic-key', song: '其他歌曲' }, { id: 2, accesskey: 'synthetic-key', song: '合成曲目' }] };
      }
      assert.equal(params.id, '2'); assert.equal(params.fmt, 'lrc');
      return { content: Buffer.from('[00:00.00]合成歌词', 'utf8').toString('base64') };
    });
  assert.deepEqual(calls, ['search', 'download']);
  assert.deepEqual(lyrics, [{ timeMs: 0, text: '合成歌词' }]);
});
