<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import {
  ArrowDownLeft,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Disc3,
  FolderOpen,
  Headphones,
  Library,
  ListMusic,
  ListPlus,
  Monitor,
  Music2,
  Play,
  Search,
  Settings2,
  Sparkles,
  Volume2,
  X,
} from '@lucide/vue';
import { parseAppInfo, type AppInfo } from '../../../packages/contracts/src/desktop';
import {
  parsePlaybackSnapshot,
  type PlaybackApi,
  type PlaybackSnapshot,
} from '../../../packages/contracts/src/playback';
import CredentialPanel from './CredentialPanel.vue';
import ProviderAccount from './ProviderAccount.vue';
import PlaybackControls from './PlaybackControls.vue';
import TrackTable from './TrackTable.vue';
import { useProvider, providerNames, type Provider } from './useProvider';
import type { DisplayTrack } from './music-ui';

const providers = {
  netease: useProvider('netease'),
  kugou: useProvider('kugou'),
};
const providerIds: Provider[] = ['netease', 'kugou'];
const view = ref<'library' | 'local' | 'settings' | Provider>('library');
const query = ref('');
const selected = ref<string[]>([]);
const queueDialog = ref<HTMLDialogElement>();
const playingDialog = ref<HTMLDialogElement>();
const queryInput = ref<HTMLInputElement>();
const mainPane = ref<HTMLElement>();
const info = ref<AppInfo>();
const loading = ref(false);
const infoError = ref('');
const toast = ref('');
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const playback = shallowRef(
  parsePlaybackSnapshot({
    revision: 0,
    generation: 0,
    status: 'idle',
    queue: [],
    currentIndex: null,
    positionSeconds: 0,
    durationSeconds: 0,
    volume: 70,
  }),
);
const playbackError = ref('');
const currentTrack = computed(() => playback.value.queue[playback.value.currentIndex ?? -1]);
const statusText = computed(
  () =>
    ({
      idle: '已停止',
      loading: '正在加载',
      playing: '正在播放',
      paused: '已暂停',
      ended: '播放结束',
      error: '播放失败',
    })[playback.value.status],
);
const localTracks = computed(() =>
  playback.value.queue.filter((t) => !t.provider || t.provider === 'local'),
);
const connectedCount = computed(
  () => providerIds.filter((id) => providers[id].state.value.status === 'connected').length,
);
const title = computed(() =>
  view.value === 'library'
    ? '音乐库'
    : view.value === 'settings'
      ? '账号与设置'
      : providerNames[view.value],
);
const activeProvider = computed(() =>
  view.value === 'netease' || view.value === 'kugou' ? view.value : undefined,
);
const providerState = computed(() =>
  activeProvider.value ? providers[activeProvider.value].state.value : undefined,
);
const playlists = computed(() =>
  providerIds.flatMap((provider) =>
    providers[provider].state.value.playlists.map((p) => ({ ...p, provider })),
  ),
);
const filteredPlaylists = computed(() =>
  playlists.value.filter(
    (p) => (!activeProvider.value || p.provider === activeProvider.value) && matches(p.name),
  ),
);
const playlistTitle = computed(
  () => providerState.value?.playlists.find((p) => p.id === providerState.value?.playlistId)?.name,
);
const tableTitle = computed(
  () => playlistTitle.value ?? (view.value === 'local' ? '本次导入' : '当前播放队列'),
);
const tracks = computed<readonly DisplayTrack[]>(() => {
  if (providerState.value)
    return providerState.value.tracks.map((t) => ({
      id: t.id,
      title: t.name,
      artist: t.artists.join('、'),
      provider: activeProvider.value!,
      durationSeconds: t.durationMs / 1000,
    }));
  const list = view.value === 'local' ? localTracks.value : playback.value.queue;
  return list.map((track) => ({
    ...track,
    ...(track.id === currentTrack.value?.id && playback.value.durationSeconds > 0
      ? { durationSeconds: playback.value.durationSeconds }
      : {}),
  }));
});
const filteredTracks = computed(() =>
  tracks.value.filter((t) => matches(`${t.title} ${t.artist ?? ''}`)),
);
const upcoming = computed(() =>
  playback.value.queue.slice((playback.value.currentIndex ?? -1) + 1),
);
const selectedTracks = computed(() =>
  filteredTracks.value.filter((t) => selected.value.includes(t.id)),
);
let unsubscribe: (() => void) | undefined;

function matches(text: string): boolean {
  return text.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase());
}
function navigate(to: typeof view.value): void {
  view.value = to;
  query.value = '';
  selected.value = [];
  void nextTick(() => mainPane.value?.scrollTo({ top: 0 }));
}
function receivePlayback(snapshot: PlaybackSnapshot): void {
  if (snapshot.revision >= playback.value.revision) playback.value = snapshot;
}
function notify(message: string): void {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
  }, 3500);
}
async function control(action: (api: PlaybackApi) => Promise<PlaybackSnapshot>): Promise<boolean> {
  playbackError.value = '';
  const generation = playback.value.generation;
  try {
    if (!window.starsMusic) throw new Error('bridge unavailable');
    const next = await action(window.starsMusic.playback);
    receivePlayback(next);
    return !next.error;
  } catch {
    if (generation === playback.value.generation)
      playbackError.value = '桌面播放操作失败，请重试。';
    return false;
  }
}
async function openFiles(): Promise<void> {
  const generation = playback.value.generation;
  const ok = await control((api) => api.openFiles());
  if (ok && playback.value.generation !== generation && localTracks.value.length) navigate('local');
}
async function play(id: string): Promise<void> {
  if (activeProvider.value) await providers[activeProvider.value].run((api) => api.playTrack(id));
  else await control((api) => api.playTrack(id));
}
async function addNext(id: string, quiet = false): Promise<boolean> {
  const ok = activeProvider.value
    ? await providers[activeProvider.value].run((api) => api.enqueueNext(id))
    : await control((api) => api.moveNext(id));
  if (ok && !quiet) notify('已加入下一首播放');
  return ok;
}
async function addSelected(): Promise<void> {
  const provider = activeProvider.value;
  const initialView = view.value;
  const generation = provider
    ? providers[provider].state.value.generation
    : playback.value.generation;
  const selection = [...selectedTracks.value];
  let count = 0;
  // 倒序插到当前项之后，保持列表中选曲的先后顺序。
  for (const track of selection.reverse()) {
    if (
      view.value !== initialView ||
      generation !==
        (provider ? providers[provider].state.value.generation : playback.value.generation)
    )
      break;
    if (track.id === currentTrack.value?.id && !activeProvider.value) continue;
    if (!(await addNext(track.id, true))) break;
    count++;
  }
  if (count) {
    notify(`已将 ${count} 首歌曲加入下一首播放`);
    selected.value = [];
  }
}
function select(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id];
}
function selectAll(): void {
  selected.value = filteredTracks.value.every((t) => selected.value.includes(t.id))
    ? []
    : filteredTracks.value.map((t) => t.id);
}
async function openPlaylist(provider: Provider, id: string): Promise<void> {
  navigate(provider);
  await providers[provider].run((api) => api.loadPlaylist(id, 0));
}
async function refreshInfo(): Promise<void> {
  loading.value = true;
  infoError.value = '';
  try {
    if (!window.starsMusic) throw new Error('bridge unavailable');
    info.value = parseAppInfo(await window.starsMusic.getAppInfo());
  } catch {
    infoError.value = '请从桌面应用启动，以使用登录与播放功能。';
  } finally {
    loading.value = false;
  }
}
function changeVolume(event: Event): void {
  void control((api) => api.setVolume(Number((event.target as HTMLInputElement).value)));
}
async function showQueue(): Promise<void> {
  await nextTick();
  queueDialog.value?.showModal();
}
function shortcuts(event: KeyboardEvent): void {
  const target = event.target as HTMLElement;
  if (
    target.closest('input, textarea, button, [contenteditable], dialog') ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  if (event.code === 'Space') {
    event.preventDefault();
    if (currentTrack.value)
      void control((api) => (playback.value.status === 'playing' ? api.pause() : api.resume()));
  }
  if (event.key === '/' && view.value !== 'settings') {
    event.preventDefault();
    queryInput.value?.focus();
  }
}
watch(
  () => [view.value, providerState.value?.generation, providerState.value?.playlistId],
  () => {
    selected.value = [];
  },
);
watch(filteredTracks, (next) => {
  selected.value = selected.value.filter((id) => next.some((t) => t.id === id));
});
onMounted(() => {
  void refreshInfo();
  if (window.starsMusic) {
    unsubscribe = window.starsMusic.playback.onStateChanged(receivePlayback);
    void control((api) => api.getState());
  }
  window.addEventListener('keydown', shortcuts);
});
onUnmounted(() => {
  unsubscribe?.();
  clearTimeout(toastTimer);
  window.removeEventListener('keydown', shortcuts);
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" aria-label="主导航">
      <a class="brand" href="#main" @click.prevent="navigate('library')"
        ><span class="brand-mark"><Sparkles :size="23" /></span>StarsMusic<span class="brand-dot"
          >.</span
        ></a
      >
      <p class="sidebar-label">音乐，随心而至</p>
      <nav class="main-navigation" aria-label="音乐库">
        <button :class="{ active: view === 'library' }" @click="navigate('library')">
          <Library :size="19" />音乐库<ChevronRight
            v-if="view === 'library'"
            class="nav-arrow"
            :size="14"
          />
        </button>
        <button :class="{ active: view === 'local' }" @click="navigate('local')">
          <FolderOpen :size="19" />本地音乐<span v-if="localTracks.length" class="nav-count">{{
            localTracks.length
          }}</span>
        </button>
      </nav>
      <p class="sidebar-label source-label">音乐来源</p>
      <nav class="main-navigation" aria-label="音乐来源">
        <button
          v-for="id in providerIds"
          :key="id"
          :class="{ active: view === id }"
          @click="navigate(id)"
        >
          <Cloud :size="19" :class="`provider-${id}`" />{{ providerNames[id]
          }}<span
            class="nav-status"
            :class="{
              connected: providers[id].state.value.status === 'connected',
            }"
            :aria-label="providers[id].state.value.status === 'connected' ? '已连接' : '未连接'"
          ></span>
        </button>
      </nav>
      <div class="sidebar-note">
        <Headphones :size="23" /><strong>所有喜欢，都在一起。</strong>
        <p>网易云、酷狗与本地音乐<br />一个安静的音乐空间。</p>
      </div>
      <button
        class="settings-nav"
        :class="{ active: view === 'settings' }"
        @click="navigate('settings')"
      >
        <Settings2 :size="18" />账号与设置
      </button>
      <span class="sidebar-footer">DESIGNED FOR LISTENING</span>
    </aside>

    <main id="main" ref="mainPane">
      <header class="topbar">
        <div class="breadcrumb">
          <span>我的音乐</span><ChevronRight :size="13" /><strong>{{ title }}</strong>
        </div>
        <label v-if="view !== 'settings'" class="search-field"
          ><Search :size="17" /><input
            ref="queryInput"
            v-model="query"
            aria-label="筛选歌曲、歌手或歌单"
            placeholder="筛选歌曲、歌手或歌单"
          /><kbd>/</kbd></label
        >
        <button class="account-shortcut" aria-label="打开账号与设置" @click="navigate('settings')">
          <span class="avatar"><Headphones :size="17" /></span
          ><span>{{ connectedCount ? `${connectedCount} 个账号已连接` : '连接音乐账号' }}</span>
        </button>
      </header>
      <div class="content" :class="{ 'settings-content': view === 'settings' }">
        <template v-if="view !== 'settings'">
          <section v-if="view === 'library' && !query" class="library-hero">
            <div class="hero-copy">
              <span class="eyebrow"><span></span> YOUR MUSIC, TOGETHER</span>
              <h1>让喜欢的音乐，<br />在这里相遇。</h1>
              <p>从一首熟悉的歌，开始今天的好心情。</p>
              <div class="hero-actions">
                <button class="primary-button" @click="openFiles">
                  <FolderOpen :size="16" />选择本地音频</button
                ><button class="hero-link" @click="navigate('settings')">
                  连接音乐账号<ArrowRight :size="16" />
                </button>
              </div>
            </div>
            <span class="hero-caption">STARS AFTER HOURS <span>VOL. 01</span></span>
          </section>
          <section
            v-if="view === 'library' && !query"
            class="source-section"
            aria-labelledby="sources-title"
          >
            <div class="section-heading">
              <h2 id="sources-title">你的音乐空间</h2>
              <span class="muted small">不同来源，同一种热爱</span>
            </div>
            <div class="source-grid">
              <button class="source-card local" @click="navigate('local')">
                <span class="source-icon"><FolderOpen :size="23" /></span
                ><span
                  ><strong>本地音乐</strong
                  ><small>{{
                    localTracks.length
                      ? `${localTracks.length} 首 · 本次会话`
                      : '从你的设备，发现好音乐'
                  }}</small></span
                ><ArrowRight :size="17" />
              </button>
              <button
                v-for="id in providerIds"
                :key="id"
                class="source-card"
                :class="id"
                @click="navigate(id)"
              >
                <span class="source-icon"><Cloud :size="23" /></span
                ><span
                  ><strong>{{ providerNames[id] }}</strong
                  ><small>{{
                    providers[id].state.value.account?.nickname ?? '连接账号，同步你的歌单'
                  }}</small></span
                ><Check
                  v-if="providers[id].state.value.status === 'connected'"
                  :size="17"
                /><ArrowRight v-else :size="17" />
              </button>
            </div>
          </section>
          <div v-if="view !== 'library'" class="page-heading">
            <div>
              <span class="eyebrow">{{
                view === 'local' ? 'ON YOUR DEVICE' : 'CONNECTED TO YOUR MUSIC'
              }}</span>
              <h1>{{ title }}</h1>
              <p>
                {{
                  view === 'local'
                    ? '把收藏的声音，留在身边。本次导入仅保留在当前会话。'
                    : '熟悉的歌单，新的聆听方式。'
                }}
              </p>
            </div>
            <button v-if="view === 'local'" class="primary-button" @click="openFiles">
              <FolderOpen :size="16" />选择本地音频</button
            ><button v-else class="subtle-button" @click="navigate('settings')">
              管理账号<ChevronRight :size="16" />
            </button>
          </div>
          <ProviderAccount
            v-if="activeProvider && providerState && providerState.status !== 'connected'"
            :provider="activeProvider"
            :state="providerState"
            :error="providers[activeProvider].error.value"
            @login="providers[activeProvider].run((api) => api.startLogin())"
            @cancel="providers[activeProvider].run((api) => api.cancelLogin())"
            @logout="providers[activeProvider].run((api) => api.logout())"
          />
          <section
            v-if="view !== 'local'"
            class="playlist-section"
            aria-labelledby="playlists-title"
          >
            <div class="section-heading">
              <div class="heading-with-count">
                <h2 id="playlists-title">我的歌单</h2>
                <span class="count-pill">{{ filteredPlaylists.length }}</span>
              </div>
              <button
                v-if="
                  activeProvider &&
                  providerState?.status === 'connected' &&
                  (providerState.playlistsMore || !providerState.playlists.length)
                "
                class="text-button"
                :disabled="providerState.busy"
                @click="providers[activeProvider].run((api) => api.loadPlaylists())"
              >
                {{
                  providerState.busy
                    ? '读取中…'
                    : providerState.playlistsMore
                      ? '加载更多歌单'
                      : '读取歌单'
                }}</button
              ><button
                v-else-if="!activeProvider"
                class="text-button"
                @click="navigate('settings')"
              >
                管理来源<ChevronRight :size="14" />
              </button>
            </div>
            <div v-if="filteredPlaylists.length" class="playlist-grid">
              <button
                v-for="playlist in filteredPlaylists"
                :key="`${playlist.provider}:${playlist.id}`"
                class="playlist-card"
                :class="[
                  playlist.provider,
                  {
                    'playlist-active':
                      providerState?.playlistId === playlist.id &&
                      activeProvider === playlist.provider,
                  },
                ]"
                :aria-pressed="
                  providerState?.playlistId === playlist.id && activeProvider === playlist.provider
                "
                @click="openPlaylist(playlist.provider, playlist.id)"
              >
                <span class="playlist-art"
                  ><ListMusic :size="32" /><span class="playlist-play"
                    ><Play :size="17" fill="currentColor" /></span
                  ><span class="playlist-provider">{{
                    playlist.provider === 'netease' ? '网易云' : '酷狗'
                  }}</span></span
                ><strong>{{ playlist.name }}</strong
                ><small>{{ playlist.trackCount }} 首歌曲</small>
              </button>
            </div>
            <div v-else class="empty-playlists">
              <ListMusic :size="25" />
              <div>
                <h3>{{ query ? '没有匹配的歌单' : '你的歌单，等你带来' }}</h3>
                <p>
                  {{
                    query
                      ? '试试其他关键词，或清除筛选。'
                      : '连接网易云或酷狗后，你的歌单会出现在这里。'
                  }}
                </p>
              </div>
              <button
                v-if="!query && !activeProvider"
                class="subtle-button"
                @click="navigate('settings')"
              >
                去连接<ArrowRight :size="15" />
              </button>
            </div>
          </section>
          <section
            v-if="tracks.length || view === 'local' || providerState?.playlistId"
            class="songs-section"
            aria-labelledby="songs-title"
          >
            <div class="section-heading">
              <div class="heading-with-count">
                <h2 id="songs-title">{{ tableTitle }}</h2>
                <span class="count-pill">{{ filteredTracks.length }}</span>
              </div>
              <button
                v-if="filteredTracks.length"
                class="primary-button compact"
                @click="play(filteredTracks[0]!.id)"
              >
                <Play :size="14" fill="currentColor" />{{
                  activeProvider ? '播放首曲' : '从头播放'
                }}
              </button>
            </div>
            <div v-if="selectedTracks.length" class="selection-bar">
              <span
                >已选择 <strong>{{ selectedTracks.length }}</strong> 首歌曲</span
              ><button class="text-button" @click="addSelected">
                <ListPlus :size="16" />下一首播放</button
              ><button class="text-button" @click="selected = []">取消选择</button>
            </div>
            <TrackTable
              v-if="filteredTracks.length"
              :tracks="filteredTracks"
              :selected="selected"
              :current-id="
                activeProvider
                  ? currentTrack?.provider === activeProvider
                    ? currentTrack.sourceId
                    : undefined
                  : currentTrack?.id
              "
              :removable="!activeProvider"
              @select="select"
              @select-all="selectAll"
              @play="play"
              @next="addNext"
              @remove="(id) => control((api) => api.removeTrack(id))"
            />
            <div v-else class="empty-library">
              <Music2 :size="32" />
              <h3>
                {{
                  query
                    ? '没有找到匹配歌曲'
                    : view === 'local'
                      ? '音乐库还是空的'
                      : providerState?.busy
                        ? '正在读取曲目…'
                        : '歌单暂未返回曲目'
                }}
              </h3>
              <p>
                {{
                  query
                    ? '试试歌曲名或歌手名。'
                    : view === 'local'
                      ? '点击上方「选择本地音频」，开启聆听。'
                      : '可尝试刷新歌单，平台权限以实际响应为准。'
                }}
              </p>
            </div>
            <button
              v-if="activeProvider && providerState?.tracksMore && providerState.playlistId"
              class="load-more"
              :disabled="providerState.busy"
              @click="
                providers[activeProvider].run((api) =>
                  api.loadPlaylist(providerState!.playlistId!, providerState!.nextTrackOffset),
                )
              "
            >
              {{ providerState.busy ? '读取中…' : '加载更多曲目' }}<ChevronDown :size="15" />
            </button>
            <p v-if="!activeProvider && tracks.length" class="list-footnote">
              仅保留本次会话 · 双击歌曲播放 · 悬停操作可加入下一首
            </p>
          </section>
          <p
            v-if="
              activeProvider &&
              (providers[activeProvider].error.value || providerState?.error) &&
              providerState?.status === 'connected'
            "
            class="error-message"
            role="alert"
          >
            {{ providers[activeProvider].error.value || providerState.error?.message }}
          </p>
          <div v-if="view === 'library' && !tracks.length && !query" class="welcome-note">
            <AudioLines :size="19" /><span
              >还没有正在播放的音乐。选一首喜欢的，让声音填满此刻。</span
            ><ArrowDownLeft :size="18" />
          </div>
        </template>

        <template v-else>
          <div class="page-heading">
            <div>
              <span class="eyebrow">MAKE YOURSELF AT HOME</span>
              <h1>账号与设置</h1>
              <p>连接音乐来源，让每一份收藏都触手可及。</p>
            </div>
          </div>
          <div class="accounts-grid">
            <ProviderAccount
              v-for="id in providerIds"
              :key="id"
              :provider="id"
              :state="providers[id].state.value"
              :error="providers[id].error.value"
              @login="providers[id].run((api) => api.startLogin())"
              @cancel="providers[id].run((api) => api.cancelLogin())"
              @logout="providers[id].run((api) => api.logout())"
            />
          </div>
          <CredentialPanel />
          <section class="runtime" aria-labelledby="runtime-title">
            <div class="section-heading">
              <div class="account-heading">
                <Monitor :size="21" />
                <div>
                  <h2 id="runtime-title">桌面连接</h2>
                  <p>当前应用的实际运行信息</p>
                </div>
              </div>
              <button class="subtle-button" :disabled="loading" @click="refreshInfo">
                {{ loading ? '读取中…' : '重新检查' }}
              </button>
            </div>
            <p v-if="infoError" class="error-message" role="alert">
              {{ infoError }}
            </p>
            <div v-else-if="info" class="runtime-info" role="status">
              <span class="connection"><Check :size="13" />桌面桥接已连接</span
              ><span>{{ info.name }} {{ info.version }}</span
              ><span>{{ info.platform }} · {{ info.arch }}</span
              ><span>Electron {{ info.electron }}</span
              ><span v-if="playback.engineVersion"
                >{{ playback.engineVersion }} · 输出
                {{ playback.audioOutput ?? '等待音频设备' }}</span
              >
            </div>
          </section>
          <p class="settings-footnote">
            StarsMusic · Linux 开发预览 / 本地目录扫描、歌词与在线搜索仍在规划中。
          </p>
        </template>
      </div>
    </main>

    <footer class="player" aria-label="播放状态">
      <button class="now-playing" aria-label="展开播放页" @click="playingDialog?.showModal()">
        <span class="mini-art"
          ><Music2 v-if="!currentTrack" :size="23" /><Disc3 v-else :size="25" /></span
        ><span class="now-playing-copy"
          ><strong>{{ currentTrack?.title ?? '此刻，听点喜欢的。' }}</strong
          ><small>{{
            currentTrack
              ? `${currentTrack.artist || providerNames[currentTrack.provider ?? 'local']} · ${statusText}`
              : '选择一首歌，开启你的音乐时刻'
          }}</small></span
        >
      </button>
      <PlaybackControls :playback="playback" @control="control" />
      <div class="player-tools">
        <span v-if="currentTrack?.detail" class="quality-label">{{ currentTrack.detail }}</span
        ><label class="volume-control"
          ><Volume2 :size="18" /><input
            aria-label="音量"
            type="range"
            min="0"
            max="100"
            :value="playback.volume"
            :style="{ '--range-progress': `${playback.volume}%` }"
            @change="changeVolume" /></label
        ><button class="queue-toggle" aria-label="打开播放队列" @click="showQueue">
          <ListMusic :size="20" /><span>{{ playback.queue.length }}</span>
        </button>
      </div>
    </footer>
    <p v-if="playbackError || playback.error" class="player-error error-message" role="alert">
      {{ playbackError || playback.error?.message
      }}<button class="text-button" @click="showQueue">查看队列</button>
    </p>
    <div v-if="toast" class="toast" role="status"><Check :size="17" />{{ toast }}</div>

    <dialog
      ref="queueDialog"
      class="queue-drawer"
      aria-labelledby="queue-title"
      @click="
        (event) => {
          if (event.target === queueDialog) queueDialog.close();
        }
      "
    >
      <div class="drawer-header">
        <div>
          <span class="eyebrow">UP NEXT</span>
          <h2 id="queue-title">
            播放队列 <span class="muted">{{ playback.queue.length }}</span>
          </h2>
        </div>
        <button class="icon-button" aria-label="关闭播放队列" @click="queueDialog?.close()">
          <X :size="21" />
        </button>
      </div>
      <div class="drawer-scroll">
        <div class="section-heading">
          <h3>
            全部歌曲 <span class="muted">{{ playback.queue.length }}</span>
          </h3>
          <button
            class="text-button"
            :disabled="!upcoming.length"
            @click="control((api) => api.clearUpcoming())"
          >
            清空后续
          </button>
        </div>
        <ol v-if="playback.queue.length" class="queue-list" aria-label="全部队列歌曲">
          <li v-for="(track, index) in playback.queue" :key="track.id" :class="{ 'is-current': index === playback.currentIndex }">
            <span class="queue-number">{{ String(index + 1).padStart(2, '0') }}</span
            ><button class="queue-song" :aria-current="index === playback.currentIndex ? 'true' : undefined" @click="control((api) => api.playTrack(track.id))">
              <strong>{{ track.title }}</strong
              ><small>{{ index === playback.currentIndex ? statusText : playback.currentIndex !== null && index < playback.currentIndex ? '已播放' : '待播放' }} · {{ track.artist || providerNames[track.provider ?? 'local'] }}</small></button
            ><button
              class="icon-button"
              :disabled="index === playback.currentIndex"
              :aria-label="`下一首播放 ${track.title}`"
              @click="control((api) => api.moveNext(track.id))"
            >
              <ListPlus :size="17" /></button
            ><button
              class="icon-button"
              :disabled="index === playback.currentIndex"
              :aria-label="`移除 ${track.title}`"
              @click="control((api) => api.removeTrack(track.id))"
            >
              <X :size="15" />
            </button>
          </li>
        </ol>
        <div v-else class="empty-queue">
          <ListMusic :size="38" />
          <h3>把下一份喜欢，排进来。</h3>
          <p>在歌曲旁点击「下一首播放」，<br />音乐会在这里接着响起。</p>
        </div>
      </div>
      <p class="drawer-footnote">顺序播放 · 会话队列 · 最多 200 首</p>
    </dialog>
    <dialog ref="playingDialog" class="playing-dialog" aria-labelledby="playing-title">
      <button
        class="icon-button close-playing"
        aria-label="收起播放页"
        @click="playingDialog?.close()"
      >
        <ChevronDown :size="24" /></button
      ><span class="eyebrow">STARS AFTER HOURS</span>
      <div class="playing-art">
        <img src="./assets/stars-night.png" alt="StarsMusic 原创星夜山景，默认播放背景" />
      </div>
      <span class="playing-source">{{
        currentTrack ? providerNames[currentTrack.provider ?? 'local'] : 'YOUR MUSIC, TOGETHER'
      }}</span>
      <h2 id="playing-title">
        {{ currentTrack?.title ?? '等一首歌，也等一个好心情。' }}
      </h2>
      <p>
        {{ currentTrack?.artist || (currentTrack ? statusText : '从本地音乐或已连接的歌单开始。') }}
      </p>
      <span v-if="currentTrack?.detail" class="quality-label">{{ currentTrack.detail }}</span
      ><PlaybackControls :playback="playback" @control="control" />
      <p class="playing-note">
        {{ currentTrack ? '播放状态与底栏同步 · Esc 收起' : '原创默认背景 · 歌词尚未接入' }}
      </p>
    </dialog>
  </div>
</template>
