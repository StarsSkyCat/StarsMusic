<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ArrowLeft, ArrowRight, Cloud, Flame, ListMusic, ListPlus, Search } from '@lucide/vue';
import type { NeteaseSnapshot } from '../../../packages/contracts/src/netease';
import { catalogPageSize, neteaseCategories, type CatalogRequest, type NeteaseCategory } from '../../../packages/contracts/src/netease-catalog';
import TrackTable from './TrackTable.vue';
import type { DisplayTrack } from './music-ui';

const props = defineProps<{ state: NeteaseSnapshot; currentId: string | undefined; error: string }>();
const tab = defineModel<'hot' | 'playlists' | 'search' | 'owned'>('tab', { default: 'hot' });
const emit = defineEmits<{
  browse: [request: CatalogRequest]; play: [id: string]; next: [id: string]; enqueue: [ids: string[]];
  openOwned: [id: string]; loadOwned: []; manage: [];
}>();
const tabs = [{ id: 'hot', label: '热歌榜', icon: Flame }, { id: 'playlists', label: '发现歌单', icon: ListMusic }, { id: 'search', label: '搜索', icon: Search }, { id: 'owned', label: '我的歌单', icon: Cloud }] as const;
const catalog = computed(() => props.state.catalog);
const keyword = ref(catalog.value.query);
const searchType = ref(catalog.value.searchType);
const category = ref<NeteaseCategory>(catalog.value.category);
const order = ref(catalog.value.order);
const selected = ref<string[]>([]);
const actionError = ref('');
const detail = ref(catalog.value.kind === 'playlist');
const relevant = computed(() => catalog.value.kind === (detail.value ? 'playlist' : tab.value));
const loading = computed(() => catalog.value.status === 'loading');
const tracks = computed<DisplayTrack[]>(() => catalog.value.tracks.map(track => ({ id: track.id, title: track.name, artist: track.artists.join('、'), provider: 'netease', durationSeconds: track.durationMs / 1000 })));
const heading = computed(() => detail.value ? catalog.value.playlist?.name ?? '公开歌单' : tab.value === 'hot' ? '云音乐热歌榜' : tab.value === 'playlists' ? '发现新的音乐收藏' : '搜索结果');

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
    <nav class="catalog-tabs" aria-label="网易云浏览">
      <button v-for="item in tabs" :key="item.id" :aria-pressed="tab === item.id" :class="{ active: tab === item.id }" @click="switchTab(item.id)"><component :is="item.icon" :size="17" />{{ item.label }}</button>
    </nav>
    <div v-if="state.status !== 'connected'" class="catalog-login-note">
      <span>先发现好音乐，连接账号后即可尝试播放。</span><button class="text-button" @click="$emit('manage')">连接网易云<ArrowRight :size="15" /></button>
    </div>
    <template v-if="tab === 'owned'">
      <div class="section-heading"><h2>我的网易云歌单</h2><button v-if="state.status === 'connected' && (state.playlistsMore || !state.playlists.length)" class="subtle-button" :disabled="state.busy" @click="$emit('loadOwned')">{{ state.busy ? '读取中…' : state.playlistsMore ? '加载更多歌单' : '读取歌单' }}</button></div>
      <div v-if="state.playlists.length" class="playlist-grid">
        <button v-for="playlist in state.playlists" :key="playlist.id" class="playlist-card netease" @click="$emit('openOwned', playlist.id)"><span class="playlist-art"><ListMusic :size="32" /><span class="playlist-provider">我的歌单</span><span class="playlist-play"><ArrowRight :size="17" /></span></span><strong>{{ playlist.name }}</strong><small>{{ playlist.trackCount }} 首歌曲</small></button>
      </div>
      <div v-else class="empty-library"><Cloud :size="30" /><h3>{{ state.status === 'connected' ? '还没有加载到歌单' : '连接你的音乐收藏' }}</h3><p>{{ state.status === 'connected' ? '点击读取歌单，或稍后重试。' : '使用官方 App 扫码后，这里会显示你的歌单。' }}</p></div>
      <p v-if="error || state.error" class="error-message" role="alert">{{ error || state.error?.message }}</p>
    </template>
    <template v-else>
      <form v-if="tab === 'search' && !detail" class="catalog-search" @submit.prevent="request()">
        <div class="catalog-search-types" aria-label="搜索内容"><button type="button" :aria-pressed="searchType === 'songs'" @click="searchType = 'songs'; request()">歌曲</button><button type="button" :aria-pressed="searchType === 'playlists'" @click="searchType = 'playlists'; request()">歌单</button></div>
        <label><Search :size="19" /><input v-model="keyword" aria-label="搜索网易云歌曲或歌单" placeholder="搜索歌曲、歌手或歌单" maxlength="100" type="search" /></label>
        <button class="primary-button" type="submit" :disabled="!keyword.trim()" :aria-busy="loading">{{ loading ? '搜索中…' : '搜索网易云' }}</button>
      </form>
      <div v-if="tab === 'playlists' && !detail" class="catalog-filters">
        <label>分类<select v-model="category" aria-label="歌单分类" @change="request()"><option v-for="item in neteaseCategories" :key="item" :value="item">{{ item }}</option></select></label>
        <label>排序<select v-model="order" aria-label="歌单排序" @change="request()"><option value="hot">热门</option><option value="new">最新</option></select></label>
      </div>
      <button v-if="detail" class="text-button catalog-back" @click="back"><ArrowLeft :size="16" />返回{{ tab === 'search' ? '搜索结果' : '歌单发现' }}</button>
      <div v-if="tab !== 'search' || catalog.kind === 'search' || detail" class="catalog-heading" :class="{ 'catalog-heading-plain': tab !== 'hot' || detail }">
        <div><span class="eyebrow">{{ detail ? 'PLAYLIST / NETEASE' : tab === 'hot' ? 'THE MOST LOVED / NETEASE' : tab === 'playlists' ? 'FIND YOUR NEXT FAVORITE' : 'SEARCH / NETEASE' }}</span><h2>{{ heading }}</h2><p v-if="catalog.kind === 'search' && !detail">“{{ catalog.query }}” · {{ catalog.total }} 个{{ catalog.searchType === 'songs' ? '歌曲' : '歌单' }}结果</p><p v-else>{{ detail ? `${catalog.total} 首歌曲` : tab === 'hot' ? '来自网易云热歌榜，播放权限以平台实际返回为准。' : '从一种心情，找到下一张喜欢的歌单。' }}</p></div>
        <span v-if="tab === 'hot' && !detail" class="catalog-hot-symbol" aria-hidden="true"><Flame :size="36" :stroke-width="1.3" /></span>
      </div>
      <div v-if="!relevant && tab === 'search' && !detail" class="empty-library"><Search :size="30" /><h3>下一首喜欢的，搜搜看</h3><p>输入歌曲、歌手或歌单关键词，再按回车搜索。</p></div>
      <div v-else-if="!relevant || loading" class="catalog-loading" role="status">正在读取网易云{{ detail ? '歌单曲目' : tab === 'search' ? '搜索结果' : tab === 'hot' ? '热歌榜' : '歌单' }}…</div>
      <div v-else-if="catalog.status === 'error'" class="catalog-error"><p class="error-message" role="alert">{{ catalog.error?.message || '暂时无法读取，请稍后重试。' }}</p><button class="subtle-button" @click="turnPage(catalog.offset)">重试</button></div>
      <template v-else>
        <div v-if="catalog.playlists.length && !tracks.length" class="playlist-grid catalog-playlists">
          <button v-for="playlist in catalog.playlists" :key="playlist.id" class="playlist-card netease" @click="openPublic(playlist.id)"><span class="playlist-art"><ListMusic :size="34" /><span class="playlist-provider">网易云 · 公开歌单</span><span class="playlist-play"><ArrowRight :size="17" /></span></span><strong>{{ playlist.name }}</strong><small>{{ playlist.trackCount }} 首歌曲</small></button>
        </div>
        <template v-else-if="tracks.length">
          <div v-if="selected.length" class="selection-bar"><span>已选择 {{ selected.length }} 首</span><button class="text-button" @click="enqueue"><ListPlus :size="16" />下一首播放</button><button class="text-button" @click="selected = []">取消选择</button></div>
          <TrackTable :tracks="tracks" :selected="selected" :current-id="currentId" :row-offset="catalog.offset" @select="select" @select-all="selectAll" @play="play" @next="id => play(id, true)" />
        </template>
        <div v-else class="empty-library"><Search :size="30" /><h3>{{ tab === 'search' && !catalog.query ? '下一首喜欢的，搜搜看' : '没有找到匹配的内容' }}</h3><p>{{ tab === 'search' ? '输入歌曲、歌手或歌单关键词，再按回车搜索。' : '试试其他分类，或稍后重新读取。' }}</p></div>
      </template>
      <p v-if="actionError || error" class="error-message" role="alert">{{ actionError || error }}<button v-if="state.status !== 'connected'" class="text-button" @click="$emit('manage')">去连接</button></p>
      <nav v-if="relevant && catalog.status === 'ready' && (catalog.tracks.length || catalog.playlists.length || catalog.offset)" class="catalog-pagination" aria-label="网易云结果分页"><button class="subtle-button" :disabled="catalog.offset === 0" @click="turnPage(Math.max(0, catalog.offset - catalogPageSize))"><ArrowLeft :size="16" />上一页</button><span>第 {{ catalog.offset / catalogPageSize + 1 }} 页<span v-if="catalog.total"> · 共 {{ catalog.total }} 项</span></span><button class="subtle-button" :disabled="!catalog.more" @click="turnPage(catalog.offset + catalogPageSize)">下一页<ArrowRight :size="16" /></button></nav>
      <p v-if="catalog.offset === 3000 && !catalog.more" class="list-footnote">已达到本次浏览范围，可通过分类或关键词缩小结果。</p>
    </template>
  </section>
</template>
