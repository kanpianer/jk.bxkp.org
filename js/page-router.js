/**
 * 家宽导航 (jiakuan.link) - 极速无缝页面平滑转场路由系统
 * 核心特性：
 * 1. 保持全局天体/云朵动态 WebGL 画布（sky-canvas）与固定背景绝对静止且不间断运行，彻底杜绝闪烁与重新加载
 * 2. 首页卡片 DOM 节点常驻内存，返回时 0ms 瞬间恢复，精准还原离开时的滚动位置与分类筛选状态
 * 3. 页面进出绝无任何滑滚/滑动动画，直接瞬时切换至文章起始位置，返回时即刻还原之前浏览位置
 * 4. 深度指南页面与首页相互即时预加载，点击 0ms 响应
 * 5. 完整支持浏览器原生前进/后退（popstate）与 URL 同步，结合 manual 模式彻底杜绝系统级滚动干扰
 */

(function () {
    'use strict';

    // 禁用浏览器原生针对单页应用的不受控自动滚动恢复，由路由引擎接管精准控制
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    // 缓存池
    const htmlCache = new Map();
    let isTransitioning = false;
    let savedHomeScroll = 0;
    let homeTitle = document.title;
    let homeCanonical = 'https://jiakuan.link/';
    let homeDescription = '';

    // 从 sessionStorage 初始化历史滚动位置（若有）
    try {
        const cachedScroll = sessionStorage.getItem('jk_home_scroll');
        if (cachedScroll !== null) {
            savedHomeScroll = parseInt(cachedScroll, 10) || 0;
        }
    } catch (e) {}

    const origMetaDesc = document.querySelector('meta[name="description"]');
    if (origMetaDesc) {
        homeDescription = origMetaDesc.getAttribute('content') || '';
    }
    const origCanonical = document.querySelector('link[rel="canonical"]');
    if (origCanonical) {
        homeCanonical = origCanonical.getAttribute('href') || homeCanonical;
    }

    // 获取规范化绝对路径
    function normalizePath(urlStr) {
        try {
            const u = new URL(urlStr, window.location.href);
            return u.pathname;
        } catch (e) {
            return urlStr;
        }
    }

    // 判断是否为深度指南文章路径
    function isGuidePath(path) {
        return /\/guides\/[^/]+\.html$/i.test(path);
    }

    // 判断是否为主页路径
    function isHomePath(path) {
        return path === '/' || path === '/index.html' || path.endsWith('/index.html') || path === '';
    }

    // 获取当前窗口真实滚动深度
    function getCurrentScroll() {
        return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    // 实时追踪主页的真实滚动位置 (RAF 节流，消除高频滚动时同步写入 sessionStorage 的卡顿)
    let scrollTrackingRaf = null;
    window.addEventListener('scroll', () => {
        if (scrollTrackingRaf) return;
        scrollTrackingRaf = requestAnimationFrame(() => {
            scrollTrackingRaf = null;
            if (!isGuidePath(normalizePath(window.location.href)) && (!guideView || guideView.style.display === 'none')) {
                const sc = getCurrentScroll();
                savedHomeScroll = sc;
                try {
                    sessionStorage.setItem('jk_home_scroll', String(savedHomeScroll));
                } catch (e) {}
            }
        });
    }, { passive: true });

    // 预加载页面
    async function prefetch(url) {
        try {
            const dest = new URL(url, window.location.origin);
            const path = dest.pathname;
            if (htmlCache.has(path)) return htmlCache.get(path);
            const res = await fetch(dest.href, { credentials: 'same-origin' });
            if (res.ok) {
                const text = await res.text();
                htmlCache.set(path, text);
                return text;
            }
        } catch (e) {}
        return null;
    }

    // 自动预加载所有深度指南及主页
    function initPrefetch() {
        const guides = [
            '/guides/dual-isp-residential-ip.html',
            '/guides/ip-fraud-check.html',
            '/guides/cross-border-ecommerce-setup.html'
        ];
        const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 800));
        schedule(() => {
            prefetch('/');
            guides.forEach(g => {
                prefetch(g);
            });
        });
    }

    // 主视图容器与指南视图容器
    let homeView = document.getElementById('homepage-view');
    let guideView = document.getElementById('guide-view');

    function ensureContainers() {
        if (!homeView) {
            homeView = document.getElementById('homepage-view');
        }
        if (!guideView) {
            guideView = document.getElementById('guide-view');
        }
    }

    // 同步左上角导航按钮显隐状态（主页显示指南按钮，文章页显示悬浮返回按钮）
    function updateFloatingNav(isGuide) {
        const guideToggle = document.getElementById('guide-toggle');
        const backBtns = document.querySelectorAll('.floating-back-btn');
        if (guideToggle) {
            guideToggle.style.display = isGuide ? 'none' : 'inline-flex';
        }
        backBtns.forEach(btn => {
            btn.style.display = isGuide ? 'inline-flex' : 'none';
        });
    }

    // 稳健瞬时应用滚动位置（绝不产生任何平滑滑动动画）
    function applyScrollInstant(top) {
        document.documentElement.style.scrollBehavior = 'auto';
        document.body.style.scrollBehavior = 'auto';
        window.scrollTo({ top: top, left: 0, behavior: 'instant' });
        document.documentElement.scrollTop = top;
        document.body.scrollTop = top;
    }

    // 多阶段恢复主页滚动位置（避免因 DOM display 切换后重排尚未完成导致的截断）
    function restoreHomeScroll(targetScroll) {
        applyScrollInstant(targetScroll);
        requestAnimationFrame(() => {
            applyScrollInstant(targetScroll);
            requestAnimationFrame(() => {
                applyScrollInstant(targetScroll);
            });
        });
        setTimeout(() => {
            applyScrollInstant(targetScroll);
        }, 40);
        setTimeout(() => {
            applyScrollInstant(targetScroll);
            isTransitioning = false;
        }, 120);
    }

    // 返回主页通用处理
    function handleGoBack() {
        if (isTransitioning) return;
        if (window.history.length > 1 && window.history.state && window.history.state.type === 'guide') {
            window.history.back();
        } else {
            showHome(true);
        }
    }

    // 绑定返回主页事件（包含全局悬浮返回按钮与文章底部返回按钮）
    function bindBackEvents() {
        document.querySelectorAll('.floating-back-btn, .guide-footer-btn').forEach(btn => {
            btn.onclick = function (e) {
                e.preventDefault();
                e.stopPropagation();
                handleGoBack();
            };
        });
    }

    // 绑定指南视图内部事件
    function bindGuideEvents() {
        bindBackEvents();
    }

    // 初始化极简返回顶部按钮
    function initBackToTop() {
        let btn = document.getElementById('back-to-top');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'back-to-top';
            btn.className = 'back-to-top-btn';
            btn.type = 'button';
            btn.setAttribute('aria-label', '返回顶部');
            btn.setAttribute('title', '返回顶部');
            btn.innerHTML = `<svg class="back-to-top-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"></path></svg>`;
            document.body.appendChild(btn);
        }

        let bttRaf = null;
        function updateVisibility() {
            if (bttRaf) return;
            bttRaf = requestAnimationFrame(() => {
                bttRaf = null;
                const sc = getCurrentScroll();
                if (sc > 300) {
                    btn.classList.add('is-visible');
                } else {
                    btn.classList.remove('is-visible');
                }
            });
        }

        btn.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            window.scrollTo({
                top: 0,
                left: 0,
                behavior: 'smooth'
            });
        };

        window.addEventListener('scroll', updateVisibility, { passive: true });
        updateVisibility();
    }

    // 执行转场：切换至指南
    async function showGuide(url, updateHistory = true) {
        if (isTransitioning) return;
        isTransitioning = true;
        ensureContainers();

        const destUrl = new URL(url, window.location.href);
        const path = destUrl.pathname;
        let html = htmlCache.get(path);
        if (!html) {
            html = await prefetch(destUrl.href);
        }

        if (!html) {
            isTransitioning = false;
            window.location.href = destUrl.href;
            return;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const incomingGuide = doc.getElementById('guide-view') || doc.querySelector('.guide-wrapper');
        const newTitle = doc.title || '家宽导航 | 深度指南';

        if (!incomingGuide) {
            isTransitioning = false;
            window.location.href = destUrl.href;
            return;
        }

        // 关键步骤 1：在离开主页之前，先精准记录主页当前的真实滚动深度，并持久化到历史状态与会话缓存
        if (isHomePath(normalizePath(window.location.href)) || (!guideView || guideView.style.display === 'none')) {
            const sc = getCurrentScroll();
            if (sc > 0 || savedHomeScroll === 0) {
                savedHomeScroll = sc;
            }
            homeTitle = document.title;
            try {
                sessionStorage.setItem('jk_home_scroll', String(savedHomeScroll));
                history.replaceState({ type: 'home', scroll: savedHomeScroll, url: '/' }, '', window.location.href);
            } catch (e) {}
        }

        // 关键步骤 2：切换视图内容
        if (homeView) {
            homeView.style.display = 'none';
        }

        if (guideView) {
            guideView.innerHTML = incomingGuide.innerHTML;
            bindGuideEvents();
            guideView.style.display = 'block';
        }

        document.body.classList.add('is-viewing-guide');
        updateFloatingNav(true);
        document.title = newTitle;

        // 同步 SEO Meta
        const canonical = document.querySelector('link[rel="canonical"]');
        const incomingCanonical = doc.querySelector('link[rel="canonical"]');
        if (canonical && incomingCanonical) {
            canonical.setAttribute('href', incomingCanonical.getAttribute('href'));
        }
        const metaDesc = document.querySelector('meta[name="description"]');
        const incomingDesc = doc.querySelector('meta[name="description"]');
        if (metaDesc && incomingDesc) {
            metaDesc.setAttribute('content', incomingDesc.getAttribute('content'));
        }

        // 关键步骤 3：先执行 pushState 写入文章历史状态，之后再置顶页面！
        // 这样绝不会污染主页历史条目的滚动位置记录为 0
        if (updateHistory) {
            history.pushState({ type: 'guide', url: path }, '', destUrl.href);
        }

        // 瞬时置顶至文章起始位置（0ms 瞬间切换，无任何滑动过程）
        applyScrollInstant(0);
        const bttGuide = document.getElementById('back-to-top');
        if (bttGuide) bttGuide.classList.remove('is-visible');

        isTransitioning = false;
    }

    // 执行转场：切换至主页（直接切换并恢复原滚动位置，无页面滑动效果）
    async function showHome(updateHistory = true) {
        if (isTransitioning) return;
        isTransitioning = true;
        ensureContainers();

        // 计算目标需要恢复的滚动位置
        let targetScroll = savedHomeScroll;
        if (window.history.state && typeof window.history.state.scroll === 'number') {
            targetScroll = window.history.state.scroll;
        } else {
            try {
                const stored = sessionStorage.getItem('jk_home_scroll');
                if (stored !== null) {
                    const parsed = parseInt(stored, 10);
                    if (!isNaN(parsed)) targetScroll = parsed;
                }
            } catch (e) {}
        }

        // 如果 homeView 内部为空（比如用户直接从外部打开深度指南页面）
        if (homeView && (!homeView.children || homeView.children.length === 0)) {
            let html = htmlCache.get('/') || htmlCache.get('/index.html') || await prefetch('/');
            if (html) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const incomingHome = doc.getElementById('homepage-view');
                if (incomingHome) {
                    homeView.innerHTML = incomingHome.innerHTML;
                    if (typeof window.__initHomePageInteractive === 'function') {
                        window.__initHomePageInteractive();
                    }
                }
            }
        }

        // 隐藏指南视图并清空内容
        if (guideView) {
            guideView.style.display = 'none';
            guideView.innerHTML = '';
        }

        document.body.classList.remove('is-viewing-guide');

        // 直接显示主页视图
        if (homeView) {
            homeView.style.display = 'block';
        }

        updateFloatingNav(false);
        document.title = homeTitle;

        // 恢复 SEO Meta
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical && homeCanonical) {
            canonical.setAttribute('href', homeCanonical);
        }
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc && homeDescription) {
            metaDesc.setAttribute('content', homeDescription);
        }

        if (updateHistory) {
            history.pushState({ type: 'home', scroll: targetScroll, url: '/' }, '', '/');
        }

        // 多阶段瞬时还原离开时的滚动位置（彻底解决重排延迟导致的 0 像素截断）
        restoreHomeScroll(targetScroll);
        const bttHome = document.getElementById('back-to-top');
        if (bttHome) {
            if (targetScroll > 300) bttHome.classList.add('is-visible');
            else bttHome.classList.remove('is-visible');
        }
    }

    // 统一路由导航入口
    function navigate(urlStr, updateHistory = true) {
        try {
            const dest = new URL(urlStr, window.location.href);
            const path = dest.pathname;

            if (isGuidePath(path)) {
                showGuide(dest.href, updateHistory);
            } else if (isHomePath(path)) {
                showHome(updateHistory);
            } else {
                window.location.href = dest.href;
            }
        } catch (e) {
            window.location.href = urlStr;
        }
    }

    // 拦截内部链接点击
    document.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        const anchor = e.target.closest('a');
        if (!anchor) return;

        // 如果是返回按钮，走专门的返回逻辑
        if (anchor.classList.contains('floating-back-btn') || anchor.classList.contains('guide-footer-btn')) {
            e.preventDefault();
            handleGoBack();
            return;
        }

        const href = anchor.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        if (anchor.target === '_blank') return;

        try {
            const dest = new URL(href, window.location.href);
            if (dest.origin === window.location.origin) {
                const path = dest.pathname;
                if (isGuidePath(path)) {
                    e.preventDefault();
                    showGuide(dest.href, true);
                } else if (isHomePath(path) && (isGuidePath(window.location.pathname) || (guideView && guideView.style.display !== 'none'))) {
                    e.preventDefault();
                    handleGoBack();
                }
            }
        } catch (err) {}
    });

    // 链接悬停即刻预加载（0ms 极速响应）
    document.addEventListener('mouseover', (e) => {
        const anchor = e.target.closest('a');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (href && !href.startsWith('#')) {
            try {
                const dest = new URL(href, window.location.href);
                if (dest.origin === window.location.origin && (isGuidePath(dest.pathname) || isHomePath(dest.pathname))) {
                    prefetch(dest.href);
                }
            } catch (err) {}
        }
    }, { passive: true });

    document.addEventListener('touchstart', (e) => {
        const anchor = e.target.closest('a');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (href && !href.startsWith('#')) {
            try {
                const dest = new URL(href, window.location.href);
                if (dest.origin === window.location.origin && (isGuidePath(dest.pathname) || isHomePath(dest.pathname))) {
                    prefetch(dest.href);
                }
            } catch (err) {}
        }
    }, { passive: true });

    // 监听浏览器前进/后退
    window.addEventListener('popstate', (e) => {
        const currentPath = normalizePath(window.location.href);
        if (isGuidePath(currentPath)) {
            showGuide(window.location.href, false);
        } else if (isHomePath(currentPath)) {
            showHome(false);
        }
    });

    // 初始化运行
    ensureContainers();
    bindBackEvents();
    initPrefetch();
    initBackToTop();

    // 校验初始历史状态与悬浮按钮显隐
    const initPath = normalizePath(window.location.href);
    const initialIsGuide = isGuidePath(initPath);
    updateFloatingNav(initialIsGuide);

    if (initialIsGuide) {
        if (!history.state) {
            history.replaceState({ type: 'guide', url: initPath }, '', window.location.href);
        }
    } else if (isHomePath(initPath)) {
        const initScroll = getCurrentScroll();
        if (!history.state) {
            history.replaceState({ type: 'home', scroll: initScroll, url: '/' }, '', window.location.href);
        }
    }

    // 暴露全局导航能力
    window.__pageRouter = {
        navigate,
        showGuide,
        showHome,
        prefetch,
        handleGoBack
    };
})();
