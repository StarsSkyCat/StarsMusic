<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ArrowLeft, ArrowRight, ArrowUpRight, AudioLines, Cloud, UserRound, ListMusic, ListPlus, Play, Search, Sparkles } from '@lucide/vue';
import type { NeteaseSnapshot } from '../../../packages/contracts/src/netease';
import { catalogPageSize, type CatalogRequest, type NeteaseCategory } from '../../../packages/contracts/src/netease-catalog';
import TrackTable from './TrackTable.vue';
import NeteaseTrackActions from './NeteaseTrackActions.vue';
import NeteaseLibraryStatus from './NeteaseLibraryStatus.vue';
import NeteaseMembership from './NeteaseMembership.vue';
import PlatformSearch from './PlatformSearch.vue';
import GlassSelect from './GlassSelect.vue';
import NeteaseArtwork from './NeteaseArtwork.vue';
import './netease.css';
import type { DisplayTrack } from './music-ui';

const props = defineProps<{ state: NeteaseSnapshot; currentId: string | undefined; error: string; starting?: boolean }>();
const tab = defineModel<'playlists' | 'search' | 'owned'>('tab', { default: 'playlists' });
const emit = defineEmits<{
  browse: [request: CatalogRequest]; play: [id: string]; next: [id: string]; enqueue: [ids: string[]];
  like: [id: string, liked: boolean]; addToPlaylist: [id: string]; subscribe: [id: string, subscribed: boolean]; refreshLibrary: []; playPlaylist: [id: string]; refreshMembership: []; openOwned: [id: string]; loadOwned: []; manage: [];
}>();
const tabs = [{ id: 'playlists', label: '发现歌单', icon: ListMusic }, { id: 'search', label: '搜索', icon: Search }, { id: 'owned', label: '我的歌单', icon: Cloud }] as const;
const catalog = computed(() => props.state.catalog);
const keyword = ref(catalog.value.query);
const searchType = ref(catalog.value.searchType);
const category = ref<NeteaseCategory>(catalog.value.category);
const order = ref(catalog.value.order);
const likedIds = computed(() => new Set(props.state.library.likedIds));
const selected = ref<string[]>([]);
const actionError = ref('');
const detail = ref(catalog.value.kind === 'playlist');
const relevant = computed(() => catalog.value.kind === (detail.value ? 'playlist' : tab.value));
const loading = computed(() => catalog.value.status === 'loading');
const tracks = computed<DisplayTrack[]>(() => catalog.value.tracks.map(track => ({ id: track.id, title: track.name, artist: track.artists.join('、'), provider: 'netease', durationSeconds: track.durationMs / 1000, ...(track.rights ? { rights: track.rights } : {}) })));
const title = computed(() => tab.value === 'playlists' ? '给心情，换张封面。' : tab.value === 'search' ? '下一次心动，从这里开始。' : '你的收藏，自成宇宙。');
const subtitle = computed(() => tab.value === 'playlists' ? '一张封面，一段新的音乐旅程。' : tab.value === 'search' ? '歌曲、歌手、歌单。让好音乐与你相遇。' : '熟悉的歌单，随时回到喜欢的声音。');
function suggest(value: string): void { keyword.value = value; request(); }
const heading = computed(() => detail.value ? catalog.value.playlist?.name ?? '公开歌单' : tab.value === 'playlists' ? '发现新的音乐收藏' : '搜索结果');

function request(offset = 0, target = tab.value): void {
  actionError.value = '';
  if (target === 'owned') { emit('loadOwned'); return; }
  if (target === 'search') {
    if (!keyword.value.trim()) return;
    emit('browse', { kind: 'search', query: keyword.value.trim(), searchType: searchType.value, offset });
  } else emit('browse', { kind: target, category: category.value, order: order.value, offset });
}
function switchTab(value: typeof tab.value): void {
  tab.value = value; detail.value = false; selected.value = []; actionError.value = '';
  if (value === 'owned') { if (props.state.status === 'connected' && !props.state.playlists.length) emit('loadOwned'); }
  else request(0, value);
}
function openPublic(id: string): void { detail.value = true; emit('browse', { kind: 'playlist', id, offset: 0 }); }
function back(): void { detail.value = false; request(); }
function turnPage(offset: number): void {
  if (detail.value && catalog.value.playlist) emit('browse', { kind: 'playlist', id: catalog.value.playlist.id, offset });
  else request(offset);
}
function select(id: string): void { selected.value = selected.value.includes(id) ? selected.value.filter(value => value !== id) : [...selected.value, id]; }
function selectAll(): void { selected.value = selected.value.length === tracks.value.length ? [] : tracks.value.map(track => track.id); }
function play(id: string, next = false): void {
  if (props.state.status !== 'connected') { actionError.value = '播放前请先连接网易云账号。'; return; }
  actionError.value = ''; if (next) emit('next', id); else emit('play', id);
}
function playPlaylist(): void {
  if (props.state.status !== 'connected') { actionError.value = '播放前请先连接网易云账号。'; return; }
  if (catalog.value.playlist) emit('playPlaylist', catalog.value.playlist.id);
}
function enqueue(): void {
  if (props.state.status !== 'connected') { actionError.value = '加入队列前请先连接网易云账号。'; return; }
  emit('enqueue', tracks.value.filter(track => selected.value.includes(track.id)).map(track => track.id)); selected.value = [];
}
watch(() => catalog.value.tracks.map(track => track.id).join(','), () => { selected.value = []; });
watch(tab, () => { detail.value = false; });
watch(() => props.state.generation, () => { selected.value = []; actionError.value = ''; detail.value = false; if (tab.value !== 'owned') request(); });
onMounted(() => {
  if (tab.value !== 'owned' && (catalog.value.status === 'idle' || (catalog.value.kind !== tab.value && catalog.value.kind !== 'playlist'))) request();
});
</script>

<template>
  <section class="netease-explore" aria-label="网易云音乐发现">
    <header class="ne-masthead">
      <div><span class="ne-kicker"><span><AudioLines :size="13" /></span> NETEASE / MUSIC SPACE</span><h1>{{ title }}</h1><p>{{ subtitle }}</p></div>
      <button class="ne-account" @click="$emit('manage')"><UserRound :size="17" /><span>{{ state.account?.nickname ?? '连接网易云' }}</span><ArrowUpRight :size="15" /></button>
    </header>
    <nav class="catalog-tabs" aria-label="网易云浏览">
      <button v-for="(item, index) in tabs" :key="item.id" :aria-pressed="tab === item.id" :class="{ active: tab === item.id }" @click="switchTab(item.id)"><component :is="item.icon" :size="17" /><span>{{ item.label }}</span><small aria-hidden="true">0{{ index + 1 }}</small></button>
    </nav>
    <NeteaseMembership v-if="state.status === 'connected'" :membership="state.membership" @refresh="$emit('refreshMembership')" />
    <NeteaseLibraryStatus v-if="state.status === 'connected'" :library="state.library" @refresh="$emit('refreshLibrary')" />
    <template v-if="tab === 'owned'">
      <div class="ne-section-heading"><div><span class="ne-kicker">YOUR COLLECTION</span><h2>我的网易云歌单<span>{{ state.playlists.length.toString().padStart(2, '0') }}</span></h2></div><button v-if="state.status === 'connected' && (state.playlistsMore || !state.playlists.length)" class="subtle-button" :disabled="state.busy" @click="$emit('loadOwned')">{{ state.busy ? '读取中…' : state.playlistsMore ? '加载更多歌单' : '读取歌单' }}</button></div>
      <div v-if="state.playlists.length" class="ne-cover-grid">
        <button v-for="(playlist, index) in state.playlists" :key="playlist.id" class="ne-cover-card" @click="$emit('openOwned', playlist.id)">
          <span class="ne-cover-image"><NeteaseArtwork :id="playlist.id" kind="playlist" :generation="state.generation" :name="playlist.name" /><span class="ne-cover-count"><ListMusic :size="12" />{{ playlist.trackCount }} 首</span><span class="ne-cover-play"><ArrowUpRight :size="21" /></span></span>
          <span class="ne-cover-copy"><small>{{ String(index + 1).padStart(2, '0') }} / {{ playlist.likedSongs ? '我喜欢的音乐' : playlist.editable ? '自建歌单' : '收藏歌单' }}</small><strong>{{ playlist.name }}</strong></span>
        </button>
      </div>
      <div v-else class="ne-empty"><span class="ne-empty-orbit"><Cloud :size="33" :stroke-width="1.2" /></span><h3>{{ state.status === 'connected' ? '还没有加载到歌单' : '连接你的音乐收藏' }}</h3><p>{{ state.status === 'connected' ? '点击读取歌单，或稍后重试。' : '使用官方 App 扫码，带上你珍藏的每一种心情。' }}</p><button v-if="state.status !== 'connected'" class="ne-primary" @click="$emit('manage')">连接账号<ArrowRight :size="16" /></button></div>
      <p v-if="error || state.error" class="error-message" role="alert">{{ error || state.error?.message }}</p>
    </template>
    <template v-else>
      <PlatformSearch v-if="tab === 'search' && !detail" v-model:keyword="keyword" v-model:search-type="searchType" provider="网易云" :loading="loading" @search="request()" />
      <div v-if="tab === 'playlists' && !detail" class="catalog-filters">
        <div class="ne-genres" aria-label="快速选择歌单分类"><button v-for="genre in (['全部', '华语', '欧美', '日语', '韩语', '流行', '摇滚', '民谣', '电子', '轻音乐', '古风', 'ACG'] as const)" :key="genre" :aria-pressed="category === genre" @click="category = genre; request()">{{ genre }}</button></div>
        <GlassSelect v-model="order" label="歌单排序" :options="[{ value: 'hot', label: '热门' }, { value: 'new', label: '最新' }]" @change="request()" />
      </div>
      <button v-if="detail" class="text-button catalog-back" @click="back"><ArrowLeft :size="16" />返回{{ tab === 'search' ? '搜索结果' : '歌单发现' }}</button>
      <div v-if="detail && catalog.playlist" class="ne-detail-hero">
        <span class="ne-detail-cover"><NeteaseArtwork :id="catalog.playlist.id" kind="playlist" :generation="state.generation" :name="catalog.playlist.name" /></span>
        <div><span class="ne-kicker">PLAYLIST / NETEASE</span><h2>{{ heading }}</h2><p>{{ catalog.total || catalog.playlist.trackCount }} 首歌曲 · 网易云音乐</p><button v-if="tracks[0]" class="ne-primary" :disabled="starting" title="将整张歌单替换为本次播放队列" @click="playPlaylist()"><Play :size="15" fill="currentColor" />{{ starting ? '读取完整歌单…' : '从第一首听起' }}</button><button v-if="state.status === 'connected' && !state.playlists.some(item => item.id === catalog.playlist?.id && item.editable)" class="subtle-button ne-subscribe" :disabled="state.library.busy" @click="$emit('subscribe', catalog.playlist.id, !state.playlists.some(item => item.id === catalog.playlist?.id && item.subscribed))">{{ state.playlists.some(item => item.id === catalog.playlist?.id && item.subscribed) ? '取消收藏歌单' : '收藏歌单' }}</button></div>
      </div>
      <div v-if="!detail && (tab !== 'search' || (catalog.kind === 'search' && relevant))" class="ne-section-heading"><div><span class="ne-kicker">{{ tab === 'playlists' ? 'PICK A MOOD / PRESS PLAY' : 'FOUND FOR YOU' }}</span><h2>{{ heading }}<span v-if="catalog.total && relevant">{{ catalog.total }}</span></h2></div><p>{{ tab === 'playlists' ? `${category} · ${order === 'hot' ? '热门收藏' : '新鲜上架'}` : `“${catalog.query}” · ${catalog.searchType === 'songs' ? '歌曲' : '歌单'}` }}</p></div>
      <div v-if="!relevant && tab === 'search' && !detail" class="ne-search-idle">
        <span class="ne-empty-orbit"><Search :size="39" :stroke-width="1" /><i></i></span><span class="ne-kicker">A NAME. A MELODY. A NEW WORLD.</span><h3>下一首喜欢的，搜搜看</h3><p>从一个名字，走进一段旋律。</p><div class="ne-search-hints"><span>试试这些关键词</span><button v-for="word in ['华语', '轻音乐', 'Live']" :key="word" @click="suggest(word)">{{ word }}<ArrowUpRight :size="13" /></button></div>
      </div>
      <div v-else-if="!relevant || loading" class="ne-loading" role="status"><span class="ne-loading-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>正在读取网易云{{ detail ? '歌单曲目' : tab === 'search' ? '搜索结果' : '歌单' }}…</div>
      <div v-else-if="catalog.status === 'error'" class="ne-empty"><Cloud :size="30" /><h3>音乐暂时没有抵达</h3><p class="error-message" role="alert">{{ catalog.error?.message || '暂时无法读取，请稍后重试。' }}</p><button class="subtle-button" @click="turnPage(catalog.offset)">重试</button></div>
      <template v-else>
        <div v-if="catalog.playlists.length && !tracks.length" class="ne-cover-grid">
          <button v-for="(playlist, index) in catalog.playlists" :key="playlist.id" class="ne-cover-card" @click="openPublic(playlist.id)">
            <span class="ne-cover-image"><NeteaseArtwork :id="playlist.id" kind="playlist" :generation="state.generation" :name="playlist.name" /><span class="ne-cover-count"><ListMusic :size="12" />{{ playlist.trackCount }} 首</span><span class="ne-cover-play"><ArrowUpRight :size="21" /></span></span>
            <span class="ne-cover-copy"><small>{{ String(catalog.offset + index + 1).padStart(2, '0') }} / NETEASE PLAYLIST</small><strong>{{ playlist.name }}</strong></span>
          </button>
        </div>
        <template v-else-if="tracks.length">
          <div v-if="selected.length" class="selection-bar"><span>已选择 {{ selected.length }} 首</span><button class="text-button" @click="enqueue"><ListPlus :size="16" />下一首播放</button><button class="text-button" @click="selected = []">取消选择</button></div>
          <TrackTable :tracks="tracks" :selected="selected" :current-id="currentId" :row-offset="catalog.offset" @select="select" @select-all="selectAll" @play="play" @next="id => play(id, true)">
            <template #actions="{ track }"><NeteaseTrackActions v-if="state.status === 'connected'" :id="track.id" :title="track.title" :liked="likedIds.has(track.id)" :likes-ready="state.library.likesStatus === 'ready'" :busy="state.library.busy" @like="(id, liked) => $emit('like', id, liked)" @add="id => $emit('addToPlaylist', id)" /></template>
            <template #artwork="{ track }"><NeteaseArtwork :id="track.id" kind="track" :generation="state.generation" :name="track.title" /></template>
          </TrackTable>
        </template>
        <div v-else class="ne-empty"><Search :size="30" /><h3>没有找到匹配的内容</h3><p>试试其他关键词或分类，或稍后重新读取。</p></div>
      </template>
      <p v-if="actionError || error" class="error-message" role="alert">{{ actionError || error }}<button v-if="state.status !== 'connected'" class="text-button" @click="$emit('manage')">去连接</button></p>
      <nav v-if="relevant && catalog.status === 'ready' && (catalog.tracks.length || catalog.playlists.length || catalog.offset)" class="catalog-pagination" aria-label="网易云结果分页"><button class="subtle-button" :disabled="catalog.offset === 0" @click="turnPage(Math.max(0, catalog.offset - catalogPageSize))"><ArrowLeft :size="16" />上一页</button><span><b>{{ String(catalog.offset / catalogPageSize + 1).padStart(2, '0') }}</b> / {{ catalog.total ? String(Math.ceil(catalog.total / catalogPageSize)).padStart(2, '0') : '更多' }}</span><button class="subtle-button" :disabled="!catalog.more" @click="turnPage(catalog.offset + catalogPageSize)">下一页<ArrowRight :size="16" /></button></nav>
      <p v-if="catalog.offset === 3000 && !catalog.more" class="list-footnote">已达到本次浏览范围，可通过分类或关键词缩小结果。</p>
    </template>
    <footer class="ne-footer"><span><Sparkles :size="12" /> MUSIC CONNECTS US.</span><small>{{ state.status === 'connected' ? '播放权限以平台实际返回为准' : '公开内容可浏览 · 连接账号后可尝试播放' }}</small></footer>
  </section>
</template>
