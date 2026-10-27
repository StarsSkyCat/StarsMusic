<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ArrowLeft, ArrowRight, ArrowUpRight, Cloud, ListMusic, ListPlus, Play, Search, Sparkles, UserRound } from '@lucide/vue';
import type { KugouSnapshot } from '../../../packages/contracts/src/kugou';
import { kugouCatalogPageSize as pageSize, type KugouCatalogRequest } from '../../../packages/contracts/src/kugou-catalog';
import TrackTable from './TrackTable.vue';
import PlatformSearch from './PlatformSearch.vue';
import KugouMembership from './KugouMembership.vue';
import KugouArtwork from './KugouArtwork.vue';
import type { DisplayTrack } from './music-ui';
import './netease.css';

const props = defineProps<{ state: KugouSnapshot; currentId: string | undefined; error: string; starting: boolean }>();
const tab = defineModel<'playlists' | 'search' | 'owned'>('tab', { default: 'playlists' });
const emit = defineEmits<{
  browse: [request: KugouCatalogRequest]; play: [id: string]; next: [id: string]; enqueue: [ids: string[]];
  playPlaylist: [id: string]; openOwned: [id: string]; loadOwned: []; refreshMembership: []; manage: [];
}>();
const catalog = computed(() => props.state.catalog);
const keyword = ref(catalog.value.query); const searchType = ref(catalog.value.searchType);
const detail = ref(catalog.value.kind === 'playlist'); const selected = ref<string[]>([]); const actionError = ref('');
const relevant = computed(() => catalog.value.kind === (detail.value ? 'playlist' : tab.value));
const tracks = computed<DisplayTrack[]>(() => catalog.value.tracks.map(track => ({ id: track.id, title: track.name, artist: track.artists.join('、'), provider: 'kugou', durationSeconds: track.durationMs / 1000, ...(track.rights ? { rights: track.rights } : {}) })));
function request(offset = 0): void {
  if (tab.value === 'owned') { emit('loadOwned'); return; }
  if (tab.value === 'search') { if (keyword.value.trim()) emit('browse', { kind: 'search', query: keyword.value.trim(), searchType: searchType.value, offset }); }
  else emit('browse', { kind: 'playlists', offset });
}
function switchTab(value: typeof tab.value): void {
  tab.value = value; detail.value = false; selected.value = []; actionError.value = '';
  if (value !== 'owned' || (props.state.status === 'connected' && !props.state.playlists.length)) request();
}
function openPublic(id: string): void { detail.value = true; emit('browse', { kind: 'playlist', id, offset: 0 }); }
function back(): void { detail.value = false; request(); }
function turnPage(offset: number): void {
  if (detail.value && catalog.value.playlist) emit('browse', { kind: 'playlist', id: catalog.value.playlist.id, offset });
  else request(offset);
}
function connected(): boolean {
  actionError.value = props.state.status === 'connected' ? '' : '播放或加入队列前，请先连接标准版酷狗音乐账号。';
  return props.state.status === 'connected';
}
function play(id: string, next = false): void { if (connected()) { if (next) emit('next', id); else emit('play', id); } }
function playPlaylist(): void { if (connected() && catalog.value.playlist) emit('playPlaylist', catalog.value.playlist.id); }
function select(id: string): void { selected.value = selected.value.includes(id) ? selected.value.filter(value => value !== id) : [...selected.value, id]; }
function selectAll(): void { selected.value = selected.value.length === tracks.value.length ? [] : tracks.value.map(track => track.id); }
function enqueue(): void { if (connected()) { emit('enqueue', tracks.value.filter(track => selected.value.includes(track.id)).map(track => track.id)); selected.value = []; } }
watch(() => catalog.value.tracks.map(track => track.id).join(','), () => { selected.value = []; });
watch(tab, () => { detail.value = false; });
watch(() => props.state.generation, () => { detail.value = false; selected.value = []; actionError.value = ''; if (tab.value !== 'owned') request(); });
onMounted(() => { if (tab.value !== 'owned' && (catalog.value.status === 'idle' || (catalog.value.kind !== tab.value && catalog.value.kind !== 'playlist'))) request(); });
</script>

<template>
  <section class="netease-explore kugou-explore" aria-label="酷狗音乐发现">
    <header class="ne-masthead"><div><h1>酷狗音乐</h1><p>{{ tab === 'owned' ? '同步你的酷狗收藏，继续熟悉的旋律。' : '搜索歌曲、发现歌单，开启一段新的聆听。' }}</p></div><button class="ne-account" @click="$emit('manage')"><UserRound :size="16" /><span>{{ state.account?.nickname ?? '连接酷狗账号' }}</span><ArrowUpRight :size="14" /></button></header>
    <nav class="catalog-tabs" aria-label="酷狗内容导航"><button v-for="item in [{ id: 'playlists', label: '发现歌单', icon: ListMusic }, { id: 'search', label: '搜索', icon: Search }, { id: 'owned', label: '我的歌单', icon: Cloud }] as const" :key="item.id" :class="{ active: tab === item.id }" :aria-current="tab === item.id ? 'page' : undefined" @click="switchTab(item.id)"><component :is="item.icon" :size="17" />{{ item.label }}</button></nav>

    <KugouMembership v-if="state.status === 'connected'" :membership="state.membership" @refresh="$emit('refreshMembership')" />
    <template v-if="tab === 'owned'">
      <div class="ne-section-heading"><div><span class="ne-kicker">YOUR COLLECTION</span><h2>我的酷狗歌单<span>{{ state.playlists.length }}</span></h2></div><button v-if="state.status === 'connected' && (state.playlistsMore || !state.playlists.length)" class="subtle-button" :disabled="state.busy" @click="$emit('loadOwned')">{{ state.busy ? '读取中…' : state.playlistsMore ? '加载更多歌单' : '读取歌单' }}</button></div>
      <div v-if="state.playlists.length" class="ne-cover-grid"><button v-for="playlist in state.playlists" :key="playlist.id" class="ne-cover-card" @click="$emit('openOwned', playlist.id)"><span class="ne-cover-image"><KugouArtwork :id="playlist.id" kind="playlist" :generation="state.generation" :name="playlist.name" /><span class="ne-cover-count"><ListMusic :size="12" />{{ playlist.trackCount }} 首</span><span class="ne-cover-play"><ArrowUpRight :size="21" /></span></span><span class="ne-cover-copy"><small>KUGOU / YOUR PLAYLIST</small><strong>{{ playlist.name }}</strong></span></button></div>
      <div v-else class="ne-empty"><Cloud :size="30" /><h3>{{ state.status === 'connected' ? '还没有读取到歌单' : '连接酷狗，找回你的收藏' }}</h3><p>{{ state.status === 'connected' ? '可重新读取，或稍后再试。' : '使用标准版酷狗 App 扫码，账号独立连接。' }}</p><button class="ne-primary" @click="state.status === 'connected' ? $emit('loadOwned') : $emit('manage')">{{ state.status === 'connected' ? '读取歌单' : '去连接' }}</button></div>
    </template>
    <template v-else>
      <button v-if="detail" class="text-button catalog-back" @click="back"><ArrowLeft :size="16" />{{ tab === 'search' ? '返回搜索结果' : '返回歌单发现' }}</button>
      <PlatformSearch v-if="tab === 'search' && !detail" v-model:keyword="keyword" v-model:search-type="searchType" provider="酷狗" :loading="catalog.status === 'loading'" @search="request()" />
      <div v-if="detail && catalog.playlist" class="ne-detail-hero"><span class="ne-detail-cover"><KugouArtwork :id="catalog.playlist.id" kind="playlist" :generation="state.generation" :name="catalog.playlist.name" /></span><div><span class="ne-kicker">PLAYLIST / KUGOU</span><h2>{{ catalog.playlist.name }}</h2><p>{{ catalog.total }} 首歌曲 · 酷狗音乐</p><button v-if="tracks.length" class="ne-primary" :disabled="starting" @click="playPlaylist"><Play :size="15" fill="currentColor" />{{ starting ? '读取完整歌单…' : '播放全部' }}</button></div></div>
      <div v-if="!detail" class="ne-section-heading"><div><span class="ne-kicker">{{ tab === 'search' ? 'FOUND FOR YOU' : 'PICK A PLAYLIST' }}</span><h2>{{ tab === 'search' ? '搜索结果' : '发现新的音乐收藏' }}<span v-if="relevant && catalog.total">{{ catalog.total }}</span></h2></div><p v-if="tab === 'search' && relevant">“{{ catalog.query }}” · {{ catalog.searchType === 'songs' ? '歌曲' : '歌单' }}</p></div>
      <div v-if="tab === 'search' && !detail && !relevant" class="ne-search-idle"><span class="ne-empty-orbit"><Search :size="39" :stroke-width="1" /><i></i></span><h3>下一首喜欢的，搜搜看</h3><p>输入歌曲、歌手或歌单关键词。</p></div>
      <div v-else-if="!relevant || catalog.status === 'loading' || catalog.status === 'idle'" class="ne-loading" role="status"><span class="ne-loading-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>正在读取酷狗{{ detail ? '歌单曲目' : tab === 'search' ? '搜索结果' : '歌单' }}…</div>
      <div v-else-if="catalog.status === 'error'" class="ne-empty"><Cloud :size="30" /><h3>音乐暂时没有抵达</h3><p class="error-message" role="alert">{{ catalog.error?.message ?? '暂时无法读取，请稍后重试。' }}</p><button class="subtle-button" @click="turnPage(catalog.offset)">重试</button></div>
      <template v-else>
        <div v-if="catalog.playlists.length" class="ne-cover-grid"><button v-for="playlist in catalog.playlists" :key="playlist.id" class="ne-cover-card" @click="openPublic(playlist.id)"><span class="ne-cover-image"><KugouArtwork :id="playlist.id" kind="playlist" :generation="state.generation" :name="playlist.name" /><span class="ne-cover-count"><ListMusic :size="12" />{{ playlist.trackCount === undefined ? '查看歌单' : `${playlist.trackCount} 首` }}</span><span class="ne-cover-play"><ArrowUpRight :size="21" /></span></span><span class="ne-cover-copy"><small>KUGOU / PLAYLIST</small><strong>{{ playlist.name }}</strong></span></button></div>
        <template v-else-if="tracks.length"><div v-if="selected.length" class="selection-bar"><span>已选择 {{ selected.length }} 首</span><button class="text-button" @click="enqueue"><ListPlus :size="16" />下一首播放</button><button class="text-button" @click="selected = []">取消选择</button></div><TrackTable :tracks="tracks" :selected="selected" :current-id="currentId" :row-offset="catalog.offset" @select="select" @select-all="selectAll" @play="play" @next="id => play(id, true)"><template #artwork="{ track }"><KugouArtwork :id="track.id" kind="track" :generation="state.generation" :name="track.title" /></template></TrackTable></template>
        <div v-else class="ne-empty"><Search :size="30" /><h3>没有找到匹配的内容</h3><p>试试其他关键词，或稍后重新读取。</p></div>
      </template>
      <nav v-if="relevant && catalog.status === 'ready' && (catalog.tracks.length || catalog.playlists.length || catalog.offset)" class="catalog-pagination" aria-label="酷狗结果分页"><button class="subtle-button" :disabled="catalog.offset === 0" @click="turnPage(Math.max(0, catalog.offset - pageSize))"><ArrowLeft :size="16" />上一页</button><span>第 <b>{{ catalog.offset / pageSize + 1 }}</b> 页<span v-if="catalog.total"> / 共 {{ Math.ceil(catalog.total / pageSize) }} 页</span></span><button class="subtle-button" :disabled="!catalog.more" @click="turnPage(catalog.offset + pageSize)">下一页<ArrowRight :size="16" /></button></nav>
      <p v-if="catalog.offset === 3000 && !catalog.more" class="list-footnote">已达到本次浏览范围，请通过关键词缩小结果。</p>
    </template>
    <p v-if="actionError || error || (tab === 'owned' && state.error)" class="error-message" role="alert">{{ actionError || error || state.error?.message }}<button v-if="state.status !== 'connected'" class="text-button" @click="$emit('manage')">去连接</button></p>
    <footer class="ne-footer"><span><Sparkles :size="12" /> MUSIC CONNECTS US.</span><small>{{ state.status === 'connected' ? '播放权限以平台实际返回为准' : '公开内容可浏览 · 连接账号后可尝试播放' }}</small></footer>
  </section>
</template>

<style>
/* 复用现有音乐空间布局，以酷狗来源色区分平台。 */
.netease-explore.kugou-explore { --ne-accent: #9bceff; --ne-ink: #152d46; --ne-tint: #84bfff12; --ne-edge: #9bceff42; --ne-shadow: #00000035; }
:root[data-theme='light'] .netease-explore.kugou-explore { --ne-accent: #2764a1; --ne-ink: #ffffff; --ne-tint: #4389c509; --ne-edge: #4389c530; --ne-shadow: #3155771a; }
.ne-cover-image > .kugou-artwork { border: 1px solid var(--glass-edge); }
</style>
