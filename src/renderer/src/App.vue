<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { parseAppInfo, type AppInfo } from '../../../packages/contracts/src/desktop';

const info = ref<AppInfo>();
const loading = ref(false);
const error = ref('');

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

onMounted(refreshInfo);
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" aria-label="应用概览">
      <div class="brand"><span class="brand-mark" aria-hidden="true">✦</span> StarsMusic</div>
      <span class="sidebar-label">我的音乐空间</span>
      <div class="current-page"><span aria-hidden="true">◫</span> 音乐库</div>
      <div class="sidebar-bottom"><span class="status-dot" aria-hidden="true"></span> P0 · 桌面基础</div>
    </aside>

    <main id="main">
      <header class="topbar"><span>音乐库</span><span class="tag">开发预览</span></header>
      <div class="content">
        <p class="eyebrow">YOUR MUSIC, TOGETHER</p>
        <h1>从这里，开启音乐之旅。</h1>
        <p class="intro">网易云、酷狗与本地音乐，一个安静的音乐空间。</p>

        <section class="empty-library" aria-labelledby="library-title">
          <div class="record" aria-hidden="true"><div>✦</div></div>
          <h2 id="library-title">音乐库还是空的</h2>
          <p>当前已搭建桌面基础，登录、导入与播放将在后续步骤接入。</p>
          <div class="sources" aria-label="计划接入的音乐来源">
            <span>网易云音乐 <small>待接入</small></span>
            <span>酷狗音乐 <small>待接入</small></span>
            <span>本地音乐 <small>待接入</small></span>
          </div>
        </section>

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
          </div>
          <p v-else role="status">正在连接桌面…</p>
        </section>
      </div>
    </main>

    <footer class="player" aria-label="播放状态">
      <div class="track-placeholder" aria-hidden="true">♫</div>
      <div><strong>尚未播放</strong><p>音频引擎待接入</p></div>
      <span class="player-note">准备好后，让音乐在这里响起。</span>
    </footer>
  </div>
</template>
