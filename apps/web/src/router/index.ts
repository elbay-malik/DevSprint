import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordInfo } from 'vue-router'

export interface RouteNamedMap {
  home: RouteRecordInfo<'home', '/', Record<never, never>, Record<never, never>, never>
  'not-found': RouteRecordInfo<
    'not-found',
    '/:pathMatch(.*)*',
    { pathMatch: string[] },
    { pathMatch: string[] },
    never
  >
}

declare module 'vue-router' {
  interface TypesConfig {
    RouteNamedMap: RouteNamedMap
  }
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
})
