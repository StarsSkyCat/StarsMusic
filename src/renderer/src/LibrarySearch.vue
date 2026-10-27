<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowLeft, ArrowRight, Cloud, ListMusic, ListPlus, Search } from '@lucide/vue';
import type { NeteaseSnapshot } from '../../../packages/contracts/src/netease';
import type { KugouSnapshot } from '../../../packages/contracts/src/kugou';
import { catalogPageSize } from '../../../packages/contracts/src/netease-catalog';
import { kugouCatalogPageSize } from '../../../packages/contracts/src/kugou-catalog';
import type { QueueTrack } from '../../../packages/contracts/src/playback';
import type { DisplayTrack } from './music-ui';
import { providerNames, type Provider } from './useProvider';
import TrackTable from './TrackTable.vue';
import NeteaseArtwork from './NeteaseArtwork.vue';
import KugouArtwork from './KugouArtwork.vue';
import './netease.css';

const props = defineProps<{
  query: string; requestId: number; searchType: 'songs' | 'playlists'; netease: NeteaseSnapshot; kugou: KugouSnapshot;
  errors: Record<Provider, string>; opening: Provider | undefined;
  localTracks: readonly DisplayTrack[]; playlists: readonly { id: string; name: string; trackCount: number; provider: Provider }[];
  currentTrack: QueueTrack | undefined;
}>();
const emit = defineEmits<{
  request: [provider: Provider, offset: number]; type: [value: 'songs' | 'playlists'];
  play: [provider: Provider | 'local', id: string, next: boolean]; enqueue: [provider: Provider | 'local', ids: string[]];
  open: [provider: Provider, id: string]; openOwned: [provider: Provider, id: string]; manage: [];
}>();
const selected = ref<Record<Provider | 'local', string[]>>({ local: [], netease: [], kugou: [] });
const actionErrors = ref<Record<Provider, string>>({ netease: '', kugou: '' });
const local = computed(() => props.localTracks.filter(track => matches(`${track.title} ${track.artist ?? ''}`)));
const owned = computed(() => props.playlists.filter(playlist => matches(playlist.name)));
function matches(value: string): boolean { return value.toLocaleLowerCase().includes(props.query.toLocaleLowerCase()); }
const sources = computed(() => (['netease', 'kugou'] as const).map(provider => {
  const state = props[provider]; const catalog = state.catalog;
  const relevant = catalog.kind === 'search' && catalog.query === props.query && catalog.searchType === props.searchType;
  const error = props.errors[provider] || (relevant ? catalog.error?.message : '') || '';
  return { provider, name: providerNames[provider], state, catalog, relevant, error,
    pageSize: provider === 'netease' ? catalogPageSize : kugouCatalogPageSize,
    tracks: catalog.tracks.map(track => ({ id: track.id, title: track.name, artist: track.artists.join('、'), durationSeconds: track.durationMs / 1000, provider, ...(track.rights ? { rights: track.rights } : {}) })) satisfies DisplayTrack[] };
}));
function current(provider: Provider | 'local'): string | undefined {
  return (props.currentTrack?.provider ?? 'local') === provider ? provider === 'local' ? props.currentTrack?.id : props.currentTrack?.sourceId : undefined;
}
function select(provider: Provider | 'local', id: string): void { selected.value[provider] = selected.value[provider].includes(id) ? selected.value[provider].filter(item => item !== id) : [...selected.value[provider], id]; }
function selectAll(provider: Provider | 'local', tracks: readonly DisplayTrack[]): void { selected.value[provider] = tracks.every(track => selected.value[provider].includes(track.id)) ? [] : tracks.map(track => track.id); }
function allowed(provider: Provider | 'local'): boolean {
  if (provider === 'local') return true;
  actionErrors.value[provider] = props[provider].status === 'connected' ? '' : `播放前请先连接${providerNames[provider]}账号。`;
  return !actionErrors.value[provider];
}
function play(provider: Provider | 'local', id: string, next = false): void { if (allowed(provider)) emit('play', provider, id, next); }
function enqueue(provider: Provider | 'local', tracks: readonly DisplayTrack[]): void {
  if (!allowed(provider)) return;
  emit('enqueue', provider, tracks.filter(track => selected.value[provider].includes(track.id)).map(track => track.id)); selected.value[provider] = [];
}
function request(provider: Provider, offset = 0): void { selected.value[provider] = []; actionErrors.value[provider] = ''; emit('request', provider, offset); }
function jump(provider: Provider | 'local'): void {
  const section = document.getElementById(`library-search-${provider}`);
  section?.scrollIntoView({ block: 'start' }); section?.querySelector('h2')?.focus({ preventScroll: true });
}
watch(() => [props.query, props.searchType, props.requestId], (_next, previous) => {
  selected.value = { local: [], netease: [], kugou: [] };
  for (const provider of ['netease', 'kugou'] as const) {
    const catalog = props[provider].catalog;
    if (previous || catalog.kind !== 'search' || catalog.query !== props.query || catalog.searchType !== props.searchType || catalog.status === 'idle') request(provider);
  }
}, { immediate: true });
for (const provider of ['netease', 'kugou'] as const) watch(() => props[provider].generation, () => request(provider));
</script>

<template>
  <section class="library-search-results" aria-label="全部来源搜索结果">
    <header class="library-search-heading"><div><span class="eyebrow">SEARCH YOUR MUSIC</span><h1>“{{ query }}”的搜索结果</h1><p>网易云音乐、酷狗音乐与已加载的本地音乐分别查询。</p></div><div class="catalog-search-types" aria-label="全部来源搜索内容"><button type="button" :aria-pressed="searchType === 'songs'" @click="$emit('type', 'songs')">歌曲</button><button type="button" :aria-pressed="searchType === 'playlists'" @click="$emit('type', 'playlists')">歌单</button></div></header>
    <nav class="library-search-jumps" aria-label="搜索来源"><button @click="jump('local')">{{ searchType === 'songs' ? '本地音乐' : '我的歌单' }}<small>{{ searchType === 'songs' ? local.length : owned.length }}</small></button><button v-for="source in sources" :key="source.provider" @click="jump(source.provider)">{{ source.name }}<small>{{ source.error ? '搜索失败' : source.relevant && source.catalog.status === 'ready' ? source.catalog.total : '查询中…' }}</small></button></nav>
    <section v-if="searchType === 'songs'" id="library-search-local" class="library-search-source" aria-label="本地音乐搜索结果">
      <div class="section-heading"><h2 tabindex="-1">本地音乐<span class="count-pill">{{ local.length }}</span></h2><span class="muted small">已加载的本地音频</span></div>
      <div v-if="selected.local.length" class="selection-bar"><span>已选择 {{ selected.local.length }} 首</span><button class="text-button" @click="enqueue('local', local)"><ListPlus :size="16" />下一首播放</button><button class="text-button" @click="selected.local = []">取消选择</button></div>
      <TrackTable v-if="local.length" :tracks="local" :selected="selected.local" :current-id="current('local')" @select="id => select('local', id)" @select-all="selectAll('local', local)" @play="id => play('local', id)" @next="id => play('local', id, true)" />
      <p v-else class="library-search-note">已加载的本地音频中没有匹配歌曲。</p>
    </section>
    <section v-else id="library-search-local" class="library-search-source" aria-label="我的歌单搜索结果"><div class="section-heading"><h2 tabindex="-1">我的歌单<span class="count-pill">{{ owned.length }}</span></h2><span class="muted small">已同步的账号歌单</span></div><div v-if="owned.length" class="library-search-owned"><button v-for="playlist in owned" :key="`${playlist.provider}:${playlist.id}`" @click="$emit('openOwned', playlist.provider, playlist.id)"><ListMusic :size="18" /><span><strong>{{ playlist.name }}</strong><small>{{ providerNames[playlist.provider] }} · {{ playlist.trackCount }} 首</small></span><ArrowRight :size="15" /></button></div><p v-else class="library-search-note">已同步的歌单中没有匹配项，平台公开歌单见下方。</p></section>
    <section v-for="source in sources" :id="`library-search-${source.provider}`" :key="source.provider" class="netease-explore library-search-source" :class="{ 'kugou-explore': source.provider === 'kugou' }" :aria-label="`${source.name}搜索结果`">
      <div class="section-heading"><h2 tabindex="-1"><Cloud :size="18" />{{ source.name }}<span v-if="source.relevant && source.catalog.status === 'ready'" class="count-pill">{{ source.catalog.total }}</span></h2><small class="muted">{{ source.state.status === 'connected' ? source.state.account?.nickname : '可匿名搜索 · 播放需连接账号' }}</small></div>
      <p v-if="opening === source.provider" class="library-search-note" role="status">正在打开歌单…</p>
      <div v-else-if="source.error || (source.relevant && source.catalog.status === 'error')" class="library-search-note"><p class="error-message" role="alert">{{ source.error || '搜索暂时不可用，请重试。' }}</p><button class="subtle-button" @click="request(source.provider, source.relevant ? source.catalog.offset : 0)">重试{{ source.name }}</button></div>
      <p v-else-if="!source.relevant || source.catalog.status === 'loading' || source.catalog.status === 'idle'" class="library-search-note" role="status">正在搜索{{ source.name }}…</p>
      <template v-else>
        <template v-if="searchType === 'songs' && source.tracks.length">
          <div v-if="selected[source.provider].length" class="selection-bar"><span>已选择 {{ selected[source.provider].length }} 首</span><button class="text-button" @click="enqueue(source.provider, source.tracks)"><ListPlus :size="16" />下一首播放</button><button class="text-button" @click="selected[source.provider] = []">取消选择</button></div>
          <TrackTable :tracks="source.tracks" :selected="selected[source.provider]" :current-id="current(source.provider)" :row-offset="source.catalog.offset" @select="id => select(source.provider, id)" @select-all="selectAll(source.provider, source.tracks)" @play="id => play(source.provider, id)" @next="id => play(source.provider, id, true)"><template #artwork="{ track }"><NeteaseArtwork v-if="source.provider === 'netease'" :id="track.id" kind="track" :generation="source.state.generation" :name="track.title" /><KugouArtwork v-else :id="track.id" kind="track" :generation="source.state.generation" :name="track.title" /></template></TrackTable>
        </template>
        <div v-else-if="searchType === 'playlists' && source.catalog.playlists.length" class="ne-cover-grid"><button v-for="playlist in source.catalog.playlists" :key="playlist.id" class="ne-cover-card" :disabled="opening !== undefined" @click="$emit('open', source.provider, playlist.id)"><span class="ne-cover-image"><NeteaseArtwork v-if="source.provider === 'netease'" :id="playlist.id" kind="playlist" :generation="source.state.generation" :name="playlist.name" /><KugouArtwork v-else :id="playlist.id" kind="playlist" :generation="source.state.generation" :name="playlist.name" /><span class="ne-cover-count"><ListMusic :size="12" />{{ playlist.trackCount === undefined ? '查看歌单' : `${playlist.trackCount} 首` }}</span></span><span class="ne-cover-copy"><strong>{{ playlist.name }}</strong></span></button></div>
        <p v-else class="library-search-note"><Search :size="17" />{{ source.name }}没有找到匹配{{ searchType === 'songs' ? '歌曲' : '歌单' }}。</p>
        <nav v-if="source.catalog.tracks.length || source.catalog.playlists.length || source.catalog.offset" class="catalog-pagination" :aria-label="`${source.name}搜索分页`"><button class="subtle-button" :disabled="source.catalog.offset === 0" @click="request(source.provider, Math.max(0, source.catalog.offset - source.pageSize))"><ArrowLeft :size="16" />上一页</button><span>第 {{ source.catalog.offset / source.pageSize + 1 }} 页</span><button class="subtle-button" :disabled="!source.catalog.more" @click="request(source.provider, source.catalog.offset + source.pageSize)">下一页<ArrowRight :size="16" /></button></nav>
      </template>
      <p v-if="actionErrors[source.provider]" class="error-message" role="alert">{{ actionErrors[source.provider] }}<button class="text-button" @click="$emit('manage')">去连接</button></p>
    </section>
  </section>
</template>

<style>
.library-search-results { min-width: 0; --ne-accent: var(--accent); }
.library-search-heading { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin: 15px 0 30px; }
.library-search-heading h1 { margin: 12px 0; font-size: clamp(23px, 3vw, 34px); overflow-wrap: anywhere; }
.library-search-heading p { font-size: 12px; color: var(--muted); line-height: 1.8; }
.library-search-heading .catalog-search-types { flex-shrink: 0; }
.library-search-jumps { display: flex; flex-wrap: wrap; gap: 8px; margin: -8px 0 28px; }
.library-search-jumps button { min-height: 40px; padding: 9px 13px; font-size: 11px; background: var(--glass); box-shadow: none; border-color: var(--line); }
.library-search-jumps small { color: var(--muted); font-size: 10px; }
.library-search-source { min-width: 0; padding: 0 0 25px; margin-bottom: 26px; border-bottom: 1px solid var(--line); }
.library-search-source .section-heading h2 { display: flex; align-items: center; gap: 10px; font-size: 18px; }
.library-search-source .section-heading > small { font-size: 10px; overflow-wrap: anywhere; text-align: right; max-width: 45%; }
.library-search-note { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-height: 60px; padding: 12px 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
.library-search-owned { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.library-search-owned > button { padding: 15px; min-width: 0; text-align: left; }
.library-search-owned > button > span { min-width: 0; flex: 1; }
.library-search-owned strong { display: block; overflow-wrap: anywhere; font-size: 12px; font-weight: 500; }
.library-search-owned small { display: block; margin-top: 5px; font-size: 10px; color: var(--muted); }
@media (max-width: 760px) { .library-search-heading { align-items: flex-start; flex-direction: column; } }
</style>
