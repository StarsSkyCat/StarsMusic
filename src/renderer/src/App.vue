<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { parseAppInfo, type AppInfo } from '../../../packages/contracts/src/desktop';
import { parsePlaybackSnapshot, type PlaybackApi, type PlaybackSnapshot } from '../../../packages/contracts/src/playback';

const info = ref<AppInfo>();
const loading = ref(false);
const error = ref('');
const playback = shallowRef(parsePlaybackSnapshot({
  revision: 0, generation: 0, status: 'idle', queue: [], currentIndex: null,
  positionSeconds: 0, durationSeconds: 0, volume: 70,
}));
const playbackError = ref('');
const seekDraft = ref<number | null>(null);
const volumeDraft = ref<number | null>(null);
const currentTrack = computed(() => playback.value.currentIndex === null ? undefined : playback.value.queue[playback.value.currentIndex]);
const statusText = computed(() => ({ idle: '已停止', loading: '正在加载', playing: '正在播放', paused: '已暂停', ended: '播放结束', error: '播放失败' })[playback.value.status]);
let unsubscribe: (() => void) | undefined;

function receivePlayback(snapshot: PlaybackSnapshot): void {
  if (snapshot.revision >= playback.value.revision) playback.value = snapshot;
}
async function control(action: (api: PlaybackApi) => Promise<PlaybackSnapshot>): Promise<void> {
  playbackError.value = '';
  try {
    if (!window.starsMusic) throw new Error('bridge unavailable');
    receivePlayback(await action(window.starsMusic.playback));
  } catch { playbackError.value = '桌面播放操作失败，请重试。'; }
}
function adjacentTrack(offset: number): void {
  const track = playback.value.queue[(playback.value.currentIndex ?? 0) + offset];
  if (track) void control((api) => api.playTrack(track.id));
}
function changeSeek(event: Event): void {
  const seconds = Number((event.target as HTMLInputElement).value);
  void control((api) => api.seek(seconds)).finally(() => { seekDraft.value = null; });
}
function changeVolume(event: Event): void {
  const volume = Number((event.target as HTMLInputElement).value);
  void control((api) => api.setVolume(volume)).finally(() => { volumeDraft.value = null; });
}
function time(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

async function refreshInfo(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    if (!window.starsMusic) throw new Error('桌面桥接不可用，请通过桌面应用启动。');
    info.value = parseAppInfo(await window.starsMusic.getAppInfo());
  } catch {
    info.value = undefined;
    error.value = '无法读取桌面信息，请确认从 Electron 启动后重试。';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refreshInfo();
  if (window.starsMusic) {
    unsubscribe = window.starsMusic.playback.onStateChanged(receivePlayback);
    void control((api) => api.getState());
  }
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" aria-label="应用概览">
      <div class="brand"><span class="brand-mark" aria-hidden="true">✦</span> StarsMusic</div>
      <span class="sidebar-label">我的音乐空间</span>
      <div class="current-page"><span aria-hidden="true">◫</span> 音乐库</div>
      <div class="sidebar-bottom"><span class="status-dot" aria-hidden="true"></span> P0 · 本地播放</div>
    </aside>

    <main id="main">
      <header class="topbar"><span>音乐库</span><span class="tag">开发预览</span></header>
      <div class="content">
        <p class="eyebrow">YOUR MUSIC, TOGETHER</p>
        <h1>从这里，开启音乐之旅。</h1>
        <p class="intro">网易云、酷狗与本地音乐，一个安静的音乐空间。</p>

        <section v-if="playback.queue.length === 0" class="empty-library" aria-labelledby="library-title">
          <div class="record" aria-hidden="true"><div>✦</div></div>
          <h2 id="library-title">音乐库还是空的</h2>
          <p>选择本地音频开始播放，支持一次选择多首。在线平台登录仍待接入。</p>
          <button class="open-files" @click="control((api) => api.openFiles())">选择本地音频</button>
          <div class="sources" aria-label="计划接入的音乐来源">
            <span>网易云音乐 <small>待接入</small></span>
            <span>酷狗音乐 <small>待接入</small></span>
            <span>本地音乐 <small>已接入 mpv</small></span>
          </div>
        </section>

        <section v-else class="local-library" aria-labelledby="queue-title">
          <div class="runtime-heading">
            <div><h2 id="queue-title">本地播放队列</h2><p>{{ playback.queue.length }} 首 · 仅保留本次会话</p></div>
            <button @click="control((api) => api.openFiles())">重新选择音频</button>
          </div>
          <ol class="track-list">
            <li v-for="(track, index) in playback.queue" :key="track.id">
              <button :aria-current="index === playback.currentIndex ? 'true' : undefined" @click="control((api) => api.playTrack(track.id))">
                <span class="track-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="track-title">{{ track.title }}</span>
                <span>{{ index === playback.currentIndex ? statusText : '本地' }}</span>
              </button>
            </li>
          </ol>
        </section>
        <p v-if="playbackError || playback.error" class="playback-error" role="alert">{{ playbackError || playback.error?.message }}</p>

        <section class="runtime" aria-labelledby="runtime-title">
          <div class="runtime-heading">
            <div><h2 id="runtime-title">桌面连接</h2><p>读取当前应用的实际运行信息</p></div>
            <button :disabled="loading" @click="refreshInfo">{{ loading ? '读取中…' : '重新检查' }}</button>
          </div>
          <p v-if="error" role="alert">{{ error }}</p>
          <div v-else-if="info" class="runtime-info" role="status">
            <span class="connection"><i class="status-dot" aria-hidden="true"></i> 桌面桥接已连接</span>
            <span>{{ info.name }} {{ info.version }}</span>
            <span>{{ info.platform }} · {{ info.arch }}</span>
            <span>Electron {{ info.electron }}</span>
            <span v-if="playback.engineVersion">{{ playback.engineVersion }} · 输出 {{ playback.audioOutput ?? '等待音频设备' }}</span>
          </div>
          <p v-else role="status">正在连接桌面…</p>
        </section>
      </div>
    </main>

    <footer class="player" aria-label="播放状态">
      <div class="track-placeholder" aria-hidden="true">♫</div>
      <div class="now-playing"><strong>{{ currentTrack?.title ?? '尚未播放' }}</strong><p>{{ currentTrack ? statusText : '选择音频即可开始' }}</p></div>
      <div class="playback-controls">
        <div class="transport">
          <button aria-label="上一首" :disabled="playback.currentIndex === null || playback.currentIndex === 0" @click="adjacentTrack(-1)">⏮</button>
          <button v-if="playback.status === 'playing'" aria-label="暂停" @click="control((api) => api.pause())">暂停</button>
          <button v-else aria-label="播放" :disabled="!currentTrack || playback.status === 'loading'" @click="control((api) => api.resume())">播放</button>
          <button aria-label="下一首" :disabled="playback.currentIndex === null || playback.currentIndex >= playback.queue.length - 1" @click="adjacentTrack(1)">⏭</button>
          <button aria-label="停止" :disabled="!currentTrack" @click="control((api) => api.stop())">停止</button>
        </div>
        <div class="seek-control">
          <span>{{ time(playback.positionSeconds) }}</span>
          <input aria-label="播放进度" type="range" min="0" :max="playback.durationSeconds || 1" step="0.1" :value="seekDraft ?? playback.positionSeconds" :disabled="!['playing', 'paused'].includes(playback.status)" @input="seekDraft = Number(($event.target as HTMLInputElement).value)" @change="changeSeek" @blur="seekDraft = null" />
          <span>{{ time(playback.durationSeconds) }}</span>
        </div>
      </div>
      <label class="volume-control">音量 <input aria-label="音量" type="range" min="0" max="100" :value="volumeDraft ?? playback.volume" @input="volumeDraft = Number(($event.target as HTMLInputElement).value)" @change="changeVolume" @blur="volumeDraft = null" /></label>
    </footer>
  </div>
</template>
