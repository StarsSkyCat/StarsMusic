import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import './themes.css';
import { initializeAppearance } from './useAppearance';

void initializeAppearance().finally(() => createApp(App).mount('#app'));
