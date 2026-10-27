<script setup lang="ts">
import PlatformArtwork from './PlatformArtwork.vue';
const props = defineProps<{ id: string; kind: 'playlist' | 'track'; generation: number; name: string }>();
</script>
<template><PlatformArtwork provider="netease" v-bind="props" /></template>
