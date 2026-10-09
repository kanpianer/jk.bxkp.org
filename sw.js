/**
 * Service Worker - 家宽导航 (jiakuan.link)
 *
 * 核心持久化与更新策略：
 * 1. 静态资源（云朵着色器/Three.js/天空大图/物理引擎/样式/字体/图标）：【Cache-First / 缓存优先】
 *    - 在用户设备本地持久化保存，后续打开直接 0ms 闪电读取，无需向服务器重复拉取 1.5MB+ 静态资源。
 *    - 无论日间模式还是暗黑模式，着色器算法和底图材质均完全常驻本地。
 * 2. 页面与卡片信息（index.html / 导航文档请求）：【Network-First / 网络优先】
 *    - 用户在线时必须优先向服务器拉取最新页面，保证卡片信息的增删改、排序、隐藏状态随时保持最新，绝对不产生过期卡片！
 *    - 仅在用户离线/无网络连接时，优雅降级提供本地缓存页面进行展示。
 */

const CACHE_VERSION = 'v1.0.1';
const STATIC_CACHE_NAME = `jkdh-static-${CACHE_VERSION}`;
const RUNTIME_CACHE_NAME = `jkdh-runtime-${CACHE_VERSION}`;

// 核心预缓存资源列表（安装时在后台自动拉取并持久化在用户设备中）
const CORE_STATIC_ASSETS = [
    './css/reset.css',
    './css/style.css',
    './js/qrcode.min.js',
    './js/sky.js',
    './images/anime_sky_bg.jpg',
    './images/airplane.svg',
    './images/ace-bg.png',
    './images/avatar.png',
    './images/og-preview.jpg',
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js'
];

// 1. Service Worker 安装：预缓存静态核心资产
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(STATIC_CACHE_NAME).then(async (cache) => {
            // 使用 Promise.allSettled 确保即使某个外部 CDN 偶尔波动，也不阻塞核心本地资源的持久化
            await Promise.allSettled(
                CORE_STATIC_ASSETS.map(async (assetUrl) => {
                    try {
                        const url = new URL(assetUrl, self.location.href).href;
                        const response = await fetch(url, { mode: 'cors' });
                        if (response && (response.ok || response.type === 'opaque')) {
                            await cache.put(url, response);
                        }
                    } catch (err) {
                        console.warn('[SW] Precache skipped for:', assetUrl, err);
                    }
                })
            );
        })
    );
});

// 2. Service Worker 激活：清理旧版本缓存，立即接管所有活跃页面
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== STATIC_CACHE_NAME && key !== RUNTIME_CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. 请求拦截分流
self.addEventListener('fetch', (event) => {
    const request = event.request;

    // 只拦截 GET 请求
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);
    const isSameOrigin = (url.origin === self.location.origin);

    // --- 策略 A：主页面与卡片信息（index.html / 导航请求）---
    // 强制采用【Network-First】，排除卡片信息的陈旧缓存，确保用户始终看到最新卡片！
    const isNavigation = (request.mode === 'navigate');
    const isHtmlDoc = url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname === '';

    if (isSameOrigin && (isNavigation || isHtmlDoc)) {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    // 在线拉取到最新页面后，异步存入本地作为离线兜底
                    if (networkResponse && networkResponse.status === 200) {
                        const copy = networkResponse.clone();
                        caches.open(RUNTIME_CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return networkResponse;
                })
                .catch(async () => {
                    // 无网/断网时，才降级读取设备本地离线缓存
                    const cached = await caches.match(request);
                    if (cached) return cached;
                    const cachedRoot = await caches.match(new URL('./', self.location.href).href);
                    if (cachedRoot) return cachedRoot;
                    return caches.match(new URL('index.html', self.location.href).href);
                })
        );
        return;
    }

    // --- 策略 B：静态大资源（云朵着色器、Three.js、天空底图、物理引擎、样式、图标、字体）---
    // 采用【Cache-First】，0ms 秒级加载，持久化驻留设备
    const isStaticAsset = (
        isSameOrigin && (
            url.pathname.includes('/css/') ||
            url.pathname.includes('/js/') ||
            url.pathname.includes('/images/') ||
            /\.(?:css|js|jpg|jpeg|png|svg|webp|ico|woff2?|ttf|eot)$/i.test(url.pathname)
        )
    ) || (
        url.hostname === 'cdnjs.cloudflare.com' ||
        url.hostname === 'fonts.googleapis.com' ||
        url.hostname === 'fonts.gstatic.com'
    );

    if (isStaticAsset) {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(request).then((networkResponse) => {
                    if (
                        networkResponse &&
                        (networkResponse.status === 200 || networkResponse.type === 'opaque')
                    ) {
                        const copy = networkResponse.clone();
                        caches.open(RUNTIME_CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return networkResponse;
                }).catch((err) => {
                    console.warn('[SW] Static asset fetch failed:', request.url, err);
                });
            })
        );
        return;
    }

    // 其他请求（如点击卡片外部跳转链接）不拦截，直接走网络
});
