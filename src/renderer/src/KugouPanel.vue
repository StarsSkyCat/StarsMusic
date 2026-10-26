<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { initialKugouSnapshot, type KugouApi, type KugouSnapshot } from '../../../packages/contracts/src/kugou';

const state = shallowRef(initialKugouSnapshot());
const error = ref('');
let unsubscribe: (() => void) | undefined;
const diagnosticLabels = {
  'authorization-userid': '授权响应缺少有效账号 ID', 'authorization-token': '授权凭据格式不受支持',
  'account-request': '账号信息请求未通过校验', 'profile-userid': '账号信息缺少有效 ID',
  'profile-mismatch': '授权账号与账号信息不一致', 'profile-nickname': '账号信息缺少昵称',
};
const labels = {
  'signed-out': '未登录', 'loading-qr': '正在获取二维码', 'waiting-scan': '请使用标准版酷狗音乐 App 扫码',
  'awaiting-confirmation': '请在 App 中确认授权', verifying: '正在验证账号', connected: '已连接',
  expired: '登录已过期', cancelled: '已取消', failed: '连接失败',
};
function receive(next: KugouSnapshot): void { if (next.revision >= state.value.revision) state.value = next; }
async function action(run: (api: KugouApi) => Promise<KugouSnapshot | void>): Promise<void> {
  error.value = '';
  try {
    if (!window.starsMusic) throw new Error('bridge unavailable');
    const result = await run(window.starsMusic.kugou);
    if (result) receive(result);
  } catch { error.value = '酷狗操作失败，请重试。'; }
}
onMounted(() => {
  if (!window.starsMusic) return;
  unsubscribe = window.starsMusic.kugou.onStateChanged(receive);
  void action((api) => api.getState());
});
onUnmounted(() => { unsubscribe?.(); state.value = initialKugouSnapshot(); });
</script>

<template>
  <section class="kugou-panel" aria-labelledby="kugou-title">
    <div class="runtime-heading">
      <div><h2 id="kugou-title">酷狗音乐</h2><p>{{ state.account?.nickname ?? labels[state.status] }} · 临时会话，退出应用后需重新登录</p></div>
      <button v-if="state.status === 'connected'" @click="action((api) => api.logout())">退出酷狗</button>
      <button v-else-if="['loading-qr', 'waiting-scan', 'awaiting-confirmation', 'verifying'].includes(state.status)" @click="action((api) => api.cancelLogin())">取消授权</button>
      <button v-else @click="action((api) => api.startLogin())">连接酷狗</button>
    </div>
    <div v-if="state.qrImage" class="qr-login">
      <img :src="state.qrImage" width="200" height="200" alt="标准版酷狗音乐 App 扫码登录二维码" draggable="false" />
      <div><strong>{{ labels[state.status] }}</strong><p>仅在官方 App 中完成授权。二维码过期后请重新获取。</p><p>请勿保存或分享登录二维码。</p></div>
    </div>
    <p v-if="error || state.error" class="playback-error" role="alert">{{ error || state.error?.message }}<span v-if="state.loginDiagnostic">（{{ diagnosticLabels[state.loginDiagnostic] }}）</span></p>
    <template v-if="state.status === 'connected'">
      <button v-if="!state.playlists.length || state.playlistsMore" class="load-playlists" :disabled="state.busy" @click="action((api) => api.loadPlaylists())">{{ state.busy ? '读取中…' : state.playlists.length ? '加载更多歌单' : '读取我的歌单' }}</button>
      <div class="playlist-buttons">
        <button v-for="playlist in state.playlists" :key="playlist.id" :aria-pressed="state.playlistId === playlist.id" @click="action((api) => api.loadPlaylist(playlist.id, 0))">{{ playlist.name }} <small>{{ playlist.trackCount }} 首</small></button>
      </div>
      <ol v-if="state.tracks.length" class="track-list">
        <li v-for="track in state.tracks" :key="track.id">
          <button @click="action((api) => api.playTrack(track.id))"><span class="track-title">{{ track.name }} <small>{{ track.artists.join('、') }}</small></span><span>播放</span></button>
        </li>
      </ol>
      <button v-if="state.tracksMore && state.playlistId" :disabled="state.busy" @click="action((api) => api.loadPlaylist(state.playlistId!, state.nextTrackOffset))">加载更多曲目</button>
      <p v-if="!state.busy && state.playlistId && !state.tracks.length">此歌单暂未返回可展示曲目。</p>
    </template>
    <p v-else-if="!state.qrImage" class="provider-note">扫码确认后验证账号，再读取歌单。歌曲权限与试听范围以平台实际响应为准。</p>
  </section>
</template>
