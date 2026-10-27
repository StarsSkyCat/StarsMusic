<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import {
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
import { useCredentials } from './useCredentials';
import CredentialPanel from './CredentialPanel.vue';
import ProviderAccount from './ProviderAccount.vue';
import PlaybackControls from './PlaybackControls.vue';
import TrackTable from './TrackTable.vue';
import NowPlayingPage from './NowPlayingPage.vue';
import GlassScene from './GlassScene.vue';
import AppearancePanel from './AppearancePanel.vue';
import NeteaseExplore from './NeteaseExplore.vue';
import NeteaseArtwork from './NeteaseArtwork.vue';
import type { NeteaseSnapshot } from '../../../packages/contracts/src/netease';
import type { CatalogRequest } from '../../../packages/contracts/src/netease-catalog';
import {
  parsePresentationSnapshot,
  type PresentationSnapshot,
} from '../../../packages/contracts/src/presentation';
import { useProvider, providerNames, type Provider } from './useProvider';
import type { DisplayTrack } from './music-ui';

const credentials = useCredentials();
const providers = {
  netease: useProvider('netease'),
  kugou: useProvider('kugou'),
};
function refreshNeteaseMembership(): void {
  void providers.netease.run(() => window.starsMusic!.netease.refreshMembership());
}
const providerIds: Provider[] = ['netease', 'kugou'];
const view = ref<'library' | 'local' | 'settings' | Provider>('library');
const query = ref('');
const selected = ref<string[]>([]);
const queueDialog = ref<HTMLDialogElement>();
const nowPlayingOpen = ref(false);
const selectedPlaylistId = ref<string>();
const neteaseTab = ref<'hot' | 'playlists' | 'search' | 'owned'>('hot');
const neteaseState = computed(() => providers.netease.state.value as NeteaseSnapshot);
let browsingScroll = 0;
const backLabel = computed(() =>
  view.value === 'library'
    ? '音乐库'
    : view.value === 'settings'
      ? '账号与设置'
      : providerNames[view.value],
);
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
const currentTrack = computed(() => playback.value.queue[playback.value.currentIndex ?? -1]);
const playbackError = ref('');
const presentation = shallowRef<PresentationSnapshot>();
let unsubscribePresentation: (() => void) | undefined;
const currentPresentation = computed(() =>
  presentation.value?.generation === playback.value.generation &&
  presentation.value?.trackId === currentTrack.value?.id
    ? presentation.value
    : undefined,
);
const artwork = computed(() => currentPresentation.value?.content?.artwork);
const artworkFailed = ref(false);
watch(artwork, () => {
  artworkFailed.value = false;
});
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
  nowPlayingOpen.value
    ? '正在播放'
    : view.value === 'library'
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
  () => providerState.value?.playlists.find((p) => p.id === selectedPlaylistId.value)?.name,
);
const tableTitle = computed(
  () => playlistTitle.value ?? (view.value === 'local' ? '本次导入' : '当前播放队列'),
);
const tracks = computed<readonly DisplayTrack[]>(() => {
  if (providerState.value) {
    if (!selectedPlaylistId.value || selectedPlaylistId.value !== providerState.value.playlistId)
      return [];
    return providerState.value.tracks.map((t) => ({
      id: t.id,
      title: t.name,
      artist: t.artists.join('、'),
      provider: activeProvider.value!,
      durationSeconds: t.durationMs / 1000,
      ...('rights' in t && t.rights ? { rights: t.rights } : {}),
    }));
  }
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
  nowPlayingOpen.value = false;
  selectedPlaylistId.value = undefined;
  view.value = to;
  query.value = '';
  selected.value = [];
  void nextTick(() => mainPane.value?.scrollTo({ top: 0 }));
}
async function openPlaying(): Promise<void> {
  if (nowPlayingOpen.value) return;
  browsingScroll = mainPane.value?.scrollTop ?? 0;
  nowPlayingOpen.value = true;
  await nextTick();
  mainPane.value?.scrollTo({ top: 0 });
  mainPane.value
    ?.querySelector<HTMLElement>('.now-playing-page h1')
    ?.focus({ preventScroll: true });
}
async function closePlaying(): Promise<void> {
  nowPlayingOpen.value = false;
  await nextTick();
  mainPane.value?.scrollTo({ top: browsingScroll });
  document.querySelector<HTMLElement>('.now-playing')?.focus({ preventScroll: true });
}
async function continueListening(): Promise<void> {
  if (currentTrack.value && ['paused', 'ended'].includes(playback.value.status))
    await control((api) => api.resume());
  await openPlaying();
}
function backToPlaylists(): void {
  selectedPlaylistId.value = undefined;
  query.value = '';
  selected.value = [];
  mainPane.value?.scrollTo({ top: 0 });
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
  if (provider === 'netease') neteaseTab.value = 'owned';
  selectedPlaylistId.value = id;
  await providers[provider].run((api) => api.loadPlaylist(id, 0));
}
async function browseNetease(request: CatalogRequest): Promise<void> {
  await providers.netease.run(() => window.starsMusic!.netease.browse(request));
}
async function enqueueCatalog(ids: string[]): Promise<void> {
  const generation = neteaseState.value.generation;
  let count = 0;
  for (const id of ids) {
    if (view.value !== 'netease' || neteaseState.value.generation !== generation) break;
    if (!(await addNext(id, true))) break;
    count++;
  }
  if (count) notify(`已将 ${count} 首歌曲加入下一首播放`);
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
  if (event.key === 'Escape' && nowPlayingOpen.value && !queueDialog.value?.open) {
    event.preventDefault();
    void closePlaying();
    return;
  }
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
  if (event.key === '/' && view.value !== 'settings' && !nowPlayingOpen.value) {
    event.preventDefault();
    if (view.value === 'netease' && !selectedPlaylistId.value) {
      neteaseTab.value = 'search';
      void nextTick(() => mainPane.value?.querySelector<HTMLInputElement>('.catalog-search input')?.focus());
      return;
    }
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
    const receivePresentation = (value: PresentationSnapshot): void => {
      if (!presentation.value || value.revision >= presentation.value.revision)
        presentation.value = parsePresentationSnapshot(value);
    };
    unsubscribePresentation = window.starsMusic.presentation.onChanged(receivePresentation);
    void window.starsMusic.presentation
      .getState()
      .then(receivePresentation)
      .catch(() => undefined);
    unsubscribe = window.starsMusic.playback.onStateChanged(receivePlayback);
    void control((api) => api.getState());
  }
  window.addEventListener('keydown', shortcuts);
});
onUnmounted(() => {
  unsubscribe?.();
  unsubscribePresentation?.();
  clearTimeout(toastTimer);
  window.removeEventListener('keydown', shortcuts);
});
</script>

<template>
  <div class="app-shell">
    <div class="ambient-field" aria-hidden="true">
      <i></i><i></i><i></i>
    </div>
    <a class="skip-link" href="#main" @click.prevent="mainPane?.focus()">跳到主内容</a>
    <aside class="sidebar" aria-label="主导航">
      <a class="brand" href="#main" @click.prevent="navigate('library')"
        ><span class="brand-mark"><Sparkles :size="23" /></span>StarsMusic<span class="brand-dot"
          >.</span
        ></a
      >
      <p class="sidebar-label">听见你的宇宙 <span>01 / EXPLORE</span></p>
      <nav class="main-navigation" aria-label="音乐库">
        <button
          :class="{ active: view === 'library' && !nowPlayingOpen }"
          :aria-current="view === 'library' && !nowPlayingOpen ? 'page' : undefined"
          @click="navigate('library')"
        >
          <Library :size="19" />音乐库<ChevronRight
            v-if="view === 'library' && !nowPlayingOpen"
            class="nav-arrow"
            :size="14"
          />
        </button>
        <button
          :class="{ active: nowPlayingOpen }"
          :aria-current="nowPlayingOpen ? 'page' : undefined"
          @click="openPlaying"
        >
          <AudioLines :size="19" />正在播放<span
            v-if="playback.status === 'playing'"
            class="nav-playing-dot"
          ></span>
        </button>
      </nav>
      <p class="sidebar-label source-label">音乐来源 <span>02 / CONNECT</span></p>
      <nav class="main-navigation" aria-label="音乐来源">
        <button
          :class="{ active: view === 'local' && !nowPlayingOpen }"
          :aria-current="view === 'local' && !nowPlayingOpen ? 'page' : undefined"
          @click="navigate('local')"
        >
          <FolderOpen :size="19" />本地音乐<span v-if="localTracks.length" class="nav-count">{{
            localTracks.length
          }}</span>
        </button>
        <button
          v-for="id in providerIds"
          :key="id"
          :class="{ active: view === id && !nowPlayingOpen }"
          :aria-current="view === id && !nowPlayingOpen ? 'page' : undefined"
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
      <button
        class="sidebar-note"
        :aria-label="`打开本次播放队列，${playback.queue.length} 首音乐`"
        @click="showQueue"
      >
        <span class="session-symbol"><AudioLines :size="22" /></span>
        <span class="sidebar-note-title">让音乐接着发生</span>
        <span class="sidebar-queue">
          <ListMusic :size="18" /><strong>{{ playback.queue.length }} 首音乐</strong
          ><ChevronRight :size="15" /></span
        ><small>顺序播放 · 本次会话</small>
      </button>
      <button
        class="settings-nav"
        :class="{ active: view === 'settings' && !nowPlayingOpen }"
        :aria-current="view === 'settings' && !nowPlayingOpen ? 'page' : undefined"
        @click="navigate('settings')"
      >
        <Settings2 :size="18" />账号与设置
      </button>
      <span class="sidebar-footer"><i></i>STARS MUSIC / LINUX</span>
    </aside>

    <main id="main" ref="mainPane" tabindex="-1" :class="{ 'is-playing-view': nowPlayingOpen }">
      <header class="topbar">
        <div class="breadcrumb">
          <span>{{ nowPlayingOpen ? '聆听空间' : '我的音乐' }}</span
          ><ChevronRight :size="13" /><strong>{{ title }}</strong>
        </div>
        <label v-if="view !== 'settings' && (view !== 'netease' || selectedPlaylistId) && !nowPlayingOpen" class="search-field"
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
      <div
        class="content"
        :class="{
          'settings-content': view === 'settings' && !nowPlayingOpen,
          'playing-content': nowPlayingOpen,
        }"
      >
        <NowPlayingPage
          v-if="nowPlayingOpen"
          :playback="playback"
          :track="currentTrack"
          :presentation="presentation"
          :artwork="artwork"
          :album="currentPresentation?.content?.album"
          :status="statusText"
          :back-label="backLabel"
          @back="closePlaying"
          @queue="showQueue"
        />
        <template v-else-if="view !== 'settings'">
          <section
            v-if="view === 'library' && !query"
            class="library-overview"
            aria-labelledby="library-title"
          >
            <div class="library-intro">
              <span class="eyebrow"><span></span>YOUR PERSONAL SOUNDSPACE</span>
              <h1 id="library-title">音乐库</h1>
              <h2 class="hero-headline">让声音，<br /><em>自由流动。</em></h2>
              <p>穿过日常的喧嚣，抵达你的音乐宇宙。</p>
              <div class="library-actions">
                <button class="primary-button" @click="openFiles">
                  <FolderOpen :size="16" />选择本地音频</button
                ><button class="text-button" @click="navigate('settings')">
                  {{ connectedCount ? '管理音乐账号' : '连接音乐账号' }}<ArrowRight :size="16" />
                </button>
              </div>
            </div>
            <div class="hero-art">
              <GlassScene />
              <span class="hero-art-label">A LITTLE SPACE. ALL YOUR MUSIC.</span>
            </div>
            <button v-if="currentTrack" class="library-current" @click="continueListening">
              <span class="library-current-art"
                ><img
                  v-if="artwork && !artworkFailed"
                  :src="artwork"
                  alt=""
                  @error="artworkFailed = true" /><Disc3 v-else :size="35" /></span
              ><span class="library-current-copy"
                ><small>继续聆听</small><strong>{{ currentTrack.title }}</strong
                ><span>{{
                  currentTrack.artist || providerNames[currentTrack.provider ?? 'local']
                }}</span></span
              ><Play :size="18" fill="currentColor" />
            </button>
            <div v-else class="library-start-note">
              <span class="library-start-icon"><Headphones :size="19" /></span>
              <div>
                <strong>好音乐，从你的收藏开始</strong>
                <p>本地音乐与平台歌单，在这里相遇。</p>
              </div>
            </div>
          </section>
          <section
            v-if="view === 'library' && !query"
            class="source-section"
            aria-labelledby="sources-title"
          >
            <div class="section-heading">
              <div class="heading-with-count">
                <span class="section-index">01</span>
                <h2 id="sources-title">你的音乐空间</h2>
              </div>
              <span class="muted small">{{ connectedCount }} / 2 个平台已连接</span>
            </div>
            <div class="source-grid">
              <button class="source-card local" @click="navigate('local')">
                <span class="source-card-top">
                  <span>ON YOUR DEVICE</span><ArrowRight :size="17" />
                </span>
                <span class="source-icon"><FolderOpen :size="23" /></span
                ><span class="source-card-copy"
                  ><strong>本地音乐</strong
                  ><small>{{
                    localTracks.length
                      ? `${localTracks.length} 首 · 本次会话`
                      : '从你的设备，发现好音乐'
                  }}</small></span
                ><span class="source-card-state"><i></i>随时出发</span>
              </button>
              <button
                v-for="id in providerIds"
                :key="id"
                class="source-card"
                :class="id"
                @click="navigate(id)"
              >
                <span class="source-card-top">
                  <span>{{ id === 'netease' ? 'NETEASE CLOUD' : 'KUGOU MUSIC' }}</span>
                  <ArrowRight :size="17" />
                </span>
                <span class="source-icon"><Cloud :size="23" /></span
                ><span class="source-card-copy"
                  ><strong>{{ providerNames[id] }}</strong
                  ><small>{{
                    providers[id].state.value.account?.nickname ?? '连接账号，同步你的歌单'
                  }}</small></span
                ><span
                  class="source-card-state"
                  :class="{ connected: providers[id].state.value.status === 'connected' }"
                  ><i></i>{{
                    providers[id].state.value.status === 'connected' ? '已连接' : '等待连接'
                  }}</span
                >
              </button>
            </div>
          </section>
          <div v-if="view !== 'library' && view !== 'netease' && !selectedPlaylistId" class="page-heading">
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
          <section v-if="activeProvider && selectedPlaylistId" class="playlist-detail-heading">
            <button class="text-button" @click="backToPlaylists">
              <ChevronRight class="back-chevron" :size="15" />返回全部歌单
            </button>
            <div class="playlist-detail-summary">
              <span class="playlist-detail-art"><NeteaseArtwork v-if="activeProvider === 'netease'" :id="selectedPlaylistId" kind="playlist" :generation="neteaseState.generation" :name="playlistTitle ?? '歌单'" /><ListMusic v-else :size="38" /></span>
              <div>
                <span class="eyebrow">{{ providerNames[activeProvider] }} · 歌单</span>
                <h1>{{ playlistTitle ?? '正在读取歌单…' }}</h1>
                <p>
                  {{ providerState?.account?.nickname
                  }}<span v-if="providerState?.tracksMore"> · 已加载 {{ tracks.length }} 首</span
                  ><span v-else> · {{ tracks.length }} 首歌曲</span>
                </p>
              </div>
            </div>
          </section>
          <NeteaseExplore
            v-if="view === 'netease' && !selectedPlaylistId"
            v-model:tab="neteaseTab"
            :state="neteaseState"
            :current-id="currentTrack?.provider === 'netease' ? currentTrack.sourceId : undefined"
            :error="providers.netease.error.value"
            @browse="browseNetease"
            @refresh-membership="refreshNeteaseMembership()"
            @play="play"
            @next="addNext"
            @enqueue="enqueueCatalog"
            @open-owned="id => openPlaylist('netease', id)"
            @load-owned="providers.netease.run(api => api.loadPlaylists())"
            @manage="navigate('settings')"
          />
          <div
            v-if="activeProvider === 'kugou' && providerState && providerState.status !== 'connected'"
            class="provider-onboarding"
          >
            <ProviderAccount
              @refresh-membership="refreshNeteaseMembership()"
              :provider="activeProvider"
              :state="providerState"
              :credentials="credentials.status.value"
              :saving="credentials.busy[activeProvider]"
              @remember="(value) => credentials.setRemember(activeProvider!, value)"
              :error="providers[activeProvider].error.value"
              @login="providers[activeProvider].run((api) => api.startLogin())"
              @cancel="providers[activeProvider].run((api) => api.cancelLogin())"
              @logout="providers[activeProvider].run((api) => api.logout())"
            />
            <aside class="provider-guide" aria-label="扫码连接步骤">
              <Headphones :size="30" :stroke-width="1.4" aria-hidden="true" />
              <span class="eyebrow">BRING YOUR FAVORITES</span>
              <h2>熟悉的收藏，<br />新的声场。</h2>
              <ol>
                <li><span>01</span>打开{{ activeProvider === 'kugou' ? '标准版酷狗音乐' : '网易云音乐' }} App</li>
                <li><span>02</span>扫描登录区域的二维码</li>
                <li><span>03</span>在官方 App 中确认授权</li>
              </ol>
              <p>无需输入密码。两个平台的账号分别连接。</p>
            </aside>
          </div>
          <section
            v-if="view !== 'local' && view !== 'netease' && !selectedPlaylistId"
            class="playlist-section"
            aria-labelledby="playlists-title"
          >
            <div class="section-heading">
              <div class="heading-with-count">
                <span class="section-index">{{ view === 'library' ? '02' : '01' }}</span>
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
                  ><NeteaseArtwork v-if="playlist.provider === 'netease'" :id="playlist.id" kind="playlist" :generation="neteaseState.generation" :name="playlist.name" /><ListMusic v-else :size="32" /><span class="playlist-play"
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
            v-if="tracks.length || view === 'local' || selectedPlaylistId"
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
        </template>

        <template v-else>
          <div class="page-heading settings-heading">
            <div>
              <span class="eyebrow">MAKE YOURSELF AT HOME</span>
              <h1>账号与设置</h1>
              <p>连接音乐来源，让每一份收藏都触手可及。</p>
            </div>
            <span class="page-heading-symbol" aria-hidden="true"><Settings2 :size="42" :stroke-width="1.2" /></span>
          </div>
          <AppearancePanel />
          <div class="accounts-grid">
            <ProviderAccount
              @refresh-membership="refreshNeteaseMembership()"
              v-for="id in providerIds"
              :key="id"
              :provider="id"
              :state="providers[id].state.value"
              :credentials="credentials.status.value"
              :saving="credentials.busy[id]"
              @remember="(value) => credentials.setRemember(id, value)"
              :error="providers[id].error.value"
              @login="providers[id].run((api) => api.startLogin())"
              @cancel="providers[id].run((api) => api.cancelLogin())"
              @logout="providers[id].run((api) => api.logout())"
            />
          </div>
          <CredentialPanel
            :status="credentials.status.value"
            :error="credentials.error.value"
            @clear="credentials.clear"
          />
          <details class="runtime-disclosure">
            <summary><Monitor :size="17" />应用信息与诊断</summary>
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
          </details>
          <p class="settings-footnote">
            StarsMusic · Linux 开发预览 / 本地目录扫描与酷狗搜索仍在规划中。
          </p>
        </template>
      </div>
    </main>

    <footer class="player" aria-label="播放状态">
      <button
        class="now-playing"
        :aria-label="nowPlayingOpen ? '返回音乐列表' : '打开播放页'"
        :aria-expanded="nowPlayingOpen"
        @click="nowPlayingOpen ? closePlaying() : openPlaying()"
      >
        <span class="mini-art"
          ><img
            v-if="artwork && !artworkFailed"
            :src="artwork"
            alt="当前歌曲专辑封面"
            @error="artworkFailed = true" /><Music2 v-else-if="!currentTrack" :size="23" /><Disc3
            v-else
            :size="25" /></span
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
          <li
            v-for="(track, index) in playback.queue"
            :key="track.id"
            :class="{ 'is-current': index === playback.currentIndex }"
          >
            <span class="queue-number">{{ String(index + 1).padStart(2, '0') }}</span
            ><button
              class="queue-song"
              :aria-current="index === playback.currentIndex ? 'true' : undefined"
              @click="control((api) => api.playTrack(track.id))"
            >
              <strong>{{ track.title }}</strong
              ><small
                >{{
                  index === playback.currentIndex
                    ? statusText
                    : playback.currentIndex !== null && index < playback.currentIndex
                      ? '已播放'
                      : '待播放'
                }}
                · {{ track.artist || providerNames[track.provider ?? 'local'] }}</small
              ></button
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
  </div>
</template>
