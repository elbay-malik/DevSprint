import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './assets/main.css'
import App from './App.vue'
import { installTheme } from '@/lib/theme'
import { router } from './router'

// Applies the `.dark` class the whole dark palette hangs off, before first paint.
installTheme()

createApp(App).use(createPinia()).use(router).mount('#app')
