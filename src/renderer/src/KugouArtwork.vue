<script setup lang="ts">
import PlatformArtwork from './PlatformArtwork.vue';
const props = defineProps<{ id: string; kind: 'playlist' | 'track'; generation: number; name: string }>();
</script>
<template><PlatformArtwork provider="kugou" v-bind="props" /></template>
