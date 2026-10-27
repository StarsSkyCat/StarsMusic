<script setup lang="ts">
import { ref } from 'vue';
import { ArrowRight, Search, X } from '@lucide/vue';
const props = defineProps<{ provider: '网易云' | '酷狗'; loading: boolean }>();
const keyword = defineModel<string>('keyword', { required: true });
const searchType = defineModel<'songs' | 'playlists'>('searchType', { required: true });
const emit = defineEmits<{ search: [] }>();
const input = ref<HTMLInputElement>();
function submit(): void { if (keyword.value.trim()) emit('search'); }
function clear(): void { keyword.value = ''; input.value?.focus(); }
function select(value: 'songs' | 'playlists'): void { if (searchType.value !== value) { searchType.value = value; submit(); } }
</script>
<template>
  <form class="catalog-search" role="search" :aria-label="`${props.provider}音乐搜索`" @submit.prevent="submit">
    <div class="ne-search-field">
      <Search class="ne-search-icon" :size="21" :stroke-width="1.7" aria-hidden="true" />
      <input ref="input" v-model="keyword" type="search" maxlength="100" :aria-label="`搜索${provider}歌曲或歌单`" placeholder="搜索歌曲、歌手或歌单" autocomplete="off" spellcheck="false" />
      <button v-if="keyword" class="ne-search-clear" type="button" aria-label="清空关键词" @click="clear"><X :size="16" /></button>
      <button class="ne-primary" type="submit" :aria-label="`搜索${provider}`" :disabled="!keyword.trim()" :aria-busy="loading">{{ loading ? '搜索中…' : '搜索' }}<ArrowRight :size="16" aria-hidden="true" /></button>
    </div>
    <div class="ne-search-bottom">
      <div class="catalog-search-types" :aria-label="`${provider}搜索内容`"><button type="button" :aria-pressed="searchType === 'songs'" @click="select('songs')">歌曲</button><button type="button" :aria-pressed="searchType === 'playlists'" @click="select('playlists')">歌单</button></div>
      <span>Enter 搜索</span>
    </div>
  </form>
</template>
