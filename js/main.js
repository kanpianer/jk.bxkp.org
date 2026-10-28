/**
 * js/main.js - 家宽导航核心交互逻辑系统
 *
 * 优化特性：
 * 1. 独立脚本文件，支持浏览器 HTTP 强缓存与 Service Worker 本地持久化 (0ms 离线启动)；
 * 2. 二维码按需懒计算：消除启动期 40 次密集 Canvas / Reed-Solomon 算力消耗，启动主线程阻塞归零；
 * 3. 消除强制同步重排：分类切换时通过单次容器重排驱动平滑渐入动画；
 * 4. 物理引擎空闲调度：Matter.js 采用 requestIdleCallback 静默加载，不争抢首屏带宽与 CPU；
 * 5. 全面保持原有功能、按键交互、快捷键、本地调试支持与彩蛋完整不变。
 */

(function () {
    'use strict';

    // 全局卡片显示更新函数引用
    let updateCardVisibilityGlobal = null;

    // 1. 初始化明暗主题与设备自适应切换系统
    function initThemeManager() {
        const toggleBtn = document.getElementById('theme-toggle');
        const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

        function getEffectiveTheme() {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const urlTheme = urlParams.get('theme');
                if (urlTheme === 'dark' || urlTheme === 'light') {
                    return urlTheme;
                }
            } catch (e) {}
            const stored = localStorage.getItem('theme');
            if (stored === 'dark' || stored === 'light') {
                return stored;
            }
            return (mediaQuery && mediaQuery.matches) ? 'dark' : 'light';
        }

        function applyTheme(theme, isUserAction = false) {
            const isDark = (theme === 'dark');
            document.documentElement.classList.toggle('theme-dark', isDark);
            document.documentElement.classList.toggle('theme-light', !isDark);
            document.documentElement.classList.remove('theme-auto');

            const meta = document.querySelector('meta[name="color-scheme"]');
            if (meta) {
                meta.content = isDark ? 'dark' : 'light';
            }

            if (toggleBtn) {
                const label = isDark ? '切换至浅色模式' : '切换至暗黑模式';
                toggleBtn.setAttribute('title', label);
                toggleBtn.setAttribute('aria-label', label);
            }

            if (window.__skySystem && typeof window.__skySystem.setDarkMode === 'function') {
                window.__skySystem.setDarkMode(isDark, !isUserAction && !document.body);
            }

            window.dispatchEvent(new CustomEvent('themechange', { detail: { theme, isDark } }));
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const current = getEffectiveTheme();
                const next = (current === 'dark') ? 'light' : 'dark';
                const systemPref = (mediaQuery && mediaQuery.matches) ? 'dark' : 'light';

                if (next === systemPref) {
                    localStorage.removeItem('theme');
                } else {
                    localStorage.setItem('theme', next);
                }
                applyTheme(next, true);
            });
        }

        if (mediaQuery) {
            mediaQuery.addEventListener('change', (e) => {
                const stored = localStorage.getItem('theme');
                if (!stored) {
                    applyTheme(e.matches ? 'dark' : 'light', false);
                }
            });
        }

        window.addEventListener('storage', (e) => {
            if (e.key === 'theme') {
                applyTheme(getEffectiveTheme(), true);
            }
        });

        window.addEventListener('pageshow', () => {
            applyTheme(getEffectiveTheme(), false);
        });

        applyTheme(getEffectiveTheme(), false);
    }

    // 2. 指南弹窗控制
    function initGuideModal() {
        const toggleBtn = document.getElementById('guide-toggle');
        const modal = document.getElementById('guide-modal');
        const closeBtn = document.getElementById('guide-modal-close');

        if (!modal) return;

        function handleWheel(e) {
            const content = modal.querySelector('.guide-modal-content');
            if (content && content.contains(e.target)) {
                if (content.scrollHeight > content.clientHeight) {
                    const isUp = e.deltaY < 0;
                    const isDown = e.deltaY > 0;
                    const atTop = content.scrollTop <= 0;
                    const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;
                    if ((isUp && atTop) || (isDown && atBottom)) {
                        e.preventDefault();
                    }
                    return;
                }
            }
            e.preventDefault();
        }

        function handleTouchMove(e) {
            const content = modal.querySelector('.guide-modal-content');
            if (content && content.contains(e.target)) {
                if (content.scrollHeight > content.clientHeight) {
                    return;
                }
            }
            e.preventDefault();
        }

        function lockScroll() {
            document.documentElement.classList.add('guide-modal-open');
            document.body.classList.add('guide-modal-open');
            document.addEventListener('wheel', handleWheel, { passive: false });
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            window.addEventListener('wheel', handleWheel, { passive: false });
            window.addEventListener('touchmove', handleTouchMove, { passive: false });
        }

        function unlockScroll() {
            document.documentElement.classList.remove('guide-modal-open');
            document.body.classList.remove('guide-modal-open');
            document.removeEventListener('wheel', handleWheel);
            document.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('wheel', handleWheel);
            window.removeEventListener('touchmove', handleTouchMove);
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (typeof window.__dismissGuideArrow === 'function') {
                    window.__dismissGuideArrow();
                }
                modal.showModal();
                lockScroll();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.close();
            });
        }

        modal.addEventListener('close', unlockScroll);
        modal.addEventListener('cancel', unlockScroll);

        // 支持点击背景遮罩层关闭弹窗
        modal.addEventListener('click', (event) => {
            if (event.target !== modal) return;
            const rect = modal.getBoundingClientRect();
            const isInDialog = (
                rect.top <= event.clientY &&
                event.clientY <= rect.bottom &&
                rect.left <= event.clientX &&
                event.clientX <= rect.right
            );
            if (!isInDialog) {
                modal.close();
            }
        });
    }

    // 2.5. 指南分类与标题联动
    function updateGuideCategory(category) {
        const guideToggle = document.getElementById('guide-toggle');
        const guideToggleText = document.getElementById('guide-toggle-text') || (guideToggle ? guideToggle.querySelector('span') : null);
        const modalTitle = document.getElementById('guide-modal-title');
        const modalBodies = document.querySelectorAll('.guide-modal-body');

        let activeBody = null;
        modalBodies.forEach(body => {
            const bodyCat = body.dataset.category;
            if (bodyCat === category) {
                body.style.display = 'block';
                activeBody = body;
            } else {
                body.style.display = 'none';
            }
        });

        const defaultTitle = (category === 'noble') ? '老站指南' : (category === 'vps' ? 'VPS指南' : '家宽指南');
        const title = (activeBody && activeBody.dataset.title) ? activeBody.dataset.title : defaultTitle;

        if (guideToggleText) {
            guideToggleText.textContent = title;
        }
        if (guideToggle) {
            guideToggle.setAttribute('aria-label', title);
            guideToggle.setAttribute('title', title);
            guideToggle.dataset.category = category;
        }
        if (modalTitle) {
            modalTitle.textContent = title;
        }
    }
    window.__updateGuideCategory = updateGuideCategory;

    // 2.5.1. 指南按钮快速高亮动效（分类切换时流畅柔和高亮）
    let guideHighlightTimer = null;
    function highlightGuideButton() {
        const guideToggle = document.getElementById('guide-toggle');
        if (!guideToggle) return;

        if (guideHighlightTimer) {
            clearTimeout(guideHighlightTimer);
            guideHighlightTimer = null;
        }

        guideToggle.classList.remove('is-switching-highlight');
        // 强制触发布局重排，确保连续快速切换分类时每次都能从头丝滑播放
        void guideToggle.offsetWidth;
        guideToggle.classList.add('is-switching-highlight');

        guideHighlightTimer = setTimeout(() => {
            guideToggle.classList.remove('is-switching-highlight');
            guideHighlightTimer = null;
        }, 900);
    }
    window.__highlightGuideButton = highlightGuideButton;

    // 2.6. 用户首次打开网站时，用黄色箭头图标飞向并指向指南按钮（带极速拖影残影与呼吸状动画）
    function initGuideArrowPrompt() {
        const STORAGE_KEY = 'jk_guide_arrow_seen';
        try {
            if (localStorage.getItem(STORAGE_KEY) === '1') {
                return;
            }
        } catch (e) {}

        const toggleBtn = document.getElementById('guide-toggle');
        if (!toggleBtn) return;

        // 计算目标位置与指向角度
        function computeTarget() {
            const rect = toggleBtn.getBoundingClientRect();
            const btnCenterX = rect.left + rect.width / 2;
            const btnCenterY = rect.top + rect.height / 2;

            const startX = window.innerWidth / 2;
            const startY = window.innerHeight / 2;

            const dx = btnCenterX - startX;
            const dy = btnCenterY - startY;
            const dist = Math.hypot(dx, dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;

            // 初始瞄准角度：由于基础 SVG 箭头默认垂直向上（-90deg），旋转角度 = atan2(dy, dx) * 180 / PI + 90
            const angleRad = Math.atan2(dy, dx);
            const rotDeg = angleRad * (180 / Math.PI) + 90;

            // 停靠距离计算：沿直线反向回退，保证尖端与按钮边缘距离约 16px，绝对不发生触碰
            const halfW = rect.width / 2;
            const halfH = rect.height / 2;
            const edgeDist = Math.hypot(halfW * Math.abs(ux), halfH * Math.abs(uy));
            const stopDist = edgeDist + 16 + 18; // 16px间距 + 18px箭头中心至尖端半高

            const targetX = btnCenterX - ux * stopDist;
            const targetY = btnCenterY - uy * stopDist;

            const deltaX = targetX - startX;
            const deltaY = targetY - startY;

            return {
                startX: Math.round(startX),
                startY: Math.round(startY),
                targetX: Math.round(targetX),
                targetY: Math.round(targetY),
                deltaX: Math.round(deltaX),
                deltaY: Math.round(deltaY),
                rotDeg: Number(rotDeg.toFixed(2))
            };
        }

        let container = document.getElementById('guide-arrow-hint');
        if (container) container.remove();

        container = document.createElement('div');
        container.id = 'guide-arrow-hint';
        container.className = 'guide-arrow-hint';
        container.setAttribute('aria-hidden', 'true');

        const params = computeTarget();

        const stage = document.createElement('div');
        stage.className = 'guide-arrow-stage';
        stage.style.setProperty('--start-x', `${params.startX}px`);
        stage.style.setProperty('--start-y', `${params.startY}px`);
        stage.style.setProperty('--delta-x', `${params.deltaX}px`);
        stage.style.setProperty('--delta-y', `${params.deltaY}px`);
        stage.style.setProperty('--arrow-angle', `${params.rotDeg}deg`);

        const arrowSvg = `
            <svg class="guide-arrow-svg" viewBox="0 0 32 32" aria-hidden="true">
                <path d="M16 2 L4 14 h7 v15 a1 1 0 0 0 1 1 h8 a1 1 0 0 0 1 -1 V 14 h7 Z"/>
            </svg>
        `;

        stage.innerHTML = arrowSvg;

        container.appendChild(stage);

        function dismissArrow() {
            if (!stage || stage.classList.contains('is-dismissing')) return;
            stage.classList.add('is-dismissing');
            try {
                localStorage.setItem(STORAGE_KEY, '1');
            } catch (e) {}
            setTimeout(() => {
                if (container && container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            }, 300);
        }

        window.__dismissGuideArrow = dismissArrow;

        stage.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleBtn.click();
        });

        // 飞行动画结束时，瞬间切换至呼吸动效，起点到终点全程连续无停顿
        stage.addEventListener('animationend', (e) => {
            if (e.animationName === 'guideArrowFlight') {
                if (!stage || stage.classList.contains('is-dismissing')) return;
                stage.classList.add('is-arrived');
            }
        });

        // 窗口尺寸变化动态微调
        window.addEventListener('resize', () => {
            if (stage && stage.classList.contains('is-arrived') && !stage.classList.contains('is-dismissing')) {
                const p = computeTarget();
                stage.style.setProperty('--start-x', `${p.startX}px`);
                stage.style.setProperty('--start-y', `${p.startY}px`);
                stage.style.setProperty('--delta-x', `${p.deltaX}px`);
                stage.style.setProperty('--delta-y', `${p.deltaY}px`);
                stage.style.setProperty('--arrow-angle', `${p.rotDeg}deg`);
            }
        });

        // 延迟 300ms 挂载进入屏幕并触发飞行动画
        setTimeout(() => {
            document.body.appendChild(container);

            // 兜底定时器（以防个别极端环境未触发 animationend 事件）
            setTimeout(() => {
                if (!stage || stage.classList.contains('is-dismissing')) return;
                if (!stage.classList.contains('is-arrived')) {
                    stage.classList.add('is-arrived');
                }
            }, 680);
        }, 300);
    }

    window.__showGuideArrow = function(force = true) {
        if (force) {
            try { localStorage.removeItem('jk_guide_arrow_seen'); } catch (e) {}
        }
        const old = document.getElementById('guide-arrow-hint');
        if (old) old.remove();
        initGuideArrowPrompt();
    };

    // 3. 自动解析卡片分类与高亮，并确保高亮（带 #）卡片自动排在对应分类最前面，隐藏卡片（带 !）排在对应分类末尾
    // 分类顺序：老站 (noble) -> 机场 (airport) -> VPS (vps)
    function initAndSortButtons() {
        const container = document.querySelector('.button-stack');
        if (!container) return;

        const buttons = Array.from(container.querySelectorAll('.button'));

        function getCategory(btn) {
            if (btn.dataset.category === 'noble') return 0;
            if (btn.dataset.category === 'airport') return 1;
            if (btn.dataset.category === 'vps') return 2;
            return 3;
        }

        function getCardPrefixes(btn) {
            let isHidden = btn.classList.contains('card-hidden');
            let isHighlight = false;
            const titleNode = btn.querySelector('.card-title');
            if (titleNode) {
                if (titleNode.classList.contains('highlight-title')) isHighlight = true;
                const text = titleNode.textContent.trim();
                const match = text.match(/^([!！#＃]+)/);
                if (match) {
                    const syms = match[1];
                    if (syms.includes('!') || syms.includes('！')) isHidden = true;
                    if (syms.includes('#') || syms.includes('＃')) isHighlight = true;
                }
            }
            return { isHidden, isHighlight };
        }

        const groups = {
            nobleHigh: [],
            nobleNormal: [],
            nobleHidden: [],
            airportHigh: [],
            airportNormal: [],
            airportHidden: [],
            vpsHigh: [],
            vpsNormal: [],
            vpsHidden: [],
            otherHigh: [],
            otherNormal: [],
            otherHidden: []
        };

        buttons.forEach(btn => {
            const cat = getCategory(btn);
            const { isHidden, isHighlight } = getCardPrefixes(btn);

            if (isHidden) {
                btn.classList.add('card-hidden');
                if (cat === 0) groups.nobleHidden.push(btn);
                else if (cat === 1) groups.airportHidden.push(btn);
                else if (cat === 2) groups.vpsHidden.push(btn);
                else groups.otherHidden.push(btn);
            } else if (isHighlight) {
                if (cat === 0) groups.nobleHigh.push(btn);
                else if (cat === 1) groups.airportHigh.push(btn);
                else if (cat === 2) groups.vpsHigh.push(btn);
                else groups.otherHigh.push(btn);
            } else {
                if (cat === 0) groups.nobleNormal.push(btn);
                else if (cat === 1) groups.airportNormal.push(btn);
                else if (cat === 2) groups.vpsNormal.push(btn);
                else groups.otherNormal.push(btn);
            }
        });

        const sortedButtons = [
            ...groups.nobleHigh,
            ...groups.nobleNormal,
            ...groups.nobleHidden,
            ...groups.airportHigh,
            ...groups.airportNormal,
            ...groups.airportHidden,
            ...groups.vpsHigh,
            ...groups.vpsNormal,
            ...groups.vpsHidden,
            ...groups.otherHigh,
            ...groups.otherNormal,
            ...groups.otherHidden
        ];

        // 重新挂载排序后的卡片
        sortedButtons.forEach(btn => container.appendChild(btn));

        // 解析卡片名称前缀，去除 !、！符号，并为带 #、＃ 的赋予高亮样式
        sortedButtons.forEach(btn => {
            const titleNode = btn.querySelector('.card-title');
            if (titleNode) {
                const trimmed = titleNode.textContent.trim();
                const match = trimmed.match(/^([!！#＃]+)\s*/);
                if (match) {
                    const syms = match[1];
                    const cleanText = trimmed.slice(match[0].length);
                    if (syms.includes('#') || syms.includes('＃')) {
                        titleNode.classList.add('highlight-title');
                    }
                    titleNode.textContent = cleanText;
                }
            }
        });
    }

    // 极速拖影动效控制器（老站：“省心”，VPS：“不难”，机场：“家宽”）
    // 每次加载网页，每一个动效字体最多出现两次，刷新页面重置
    const speedToastMaxLimit = 2;
    const speedToastCounts = {
        noble: 0,
        vps: 0,
        airport: 0
    };
    let activeSpeedToastTimer = null;
    function dismissCategorySpeedToast() {
        if (activeSpeedToastTimer) {
            clearTimeout(activeSpeedToastTimer);
            activeSpeedToastTimer = null;
        }
        const overlay = document.querySelector('.category-speed-toast-overlay');
        if (overlay) {
            overlay.innerHTML = '';
        }
    }

    function triggerCategorySpeedToast(text, type) {
        if (document.body.classList.contains('cards-falling')) return;

        const countKey = type || text;
        if ((speedToastCounts[countKey] || 0) >= speedToastMaxLimit) {
            return;
        }
        speedToastCounts[countKey] = (speedToastCounts[countKey] || 0) + 1;

        dismissCategorySpeedToast();

        let overlay = document.querySelector('.category-speed-toast-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'category-speed-toast-overlay';
            overlay.setAttribute('aria-hidden', 'true');
            document.body.appendChild(overlay);
        }

        // 计算卡片在视口中的定位坐标（桌面设备居中于两排卡片水平中间位置）
        const stack = document.querySelector('.button-stack');
        let targetY = window.innerHeight * 0.4;
        let targetX = window.innerWidth / 2;
        if (stack) {
            const stackRect = stack.getBoundingClientRect();
            if (stackRect.width > 0) {
                targetX = stackRect.left + stackRect.width / 2;
            }

            const visibleCards = Array.from(stack.querySelectorAll('.button')).filter(card => {
                return window.getComputedStyle(card).display !== 'none';
            });

            if (visibleCards.length > 0) {
                // 按卡片顶部 Y 坐标进行行聚合（容差 8px，处理不同列细微布局重排公差）
                const rows = [];
                visibleCards.forEach(card => {
                    const rect = card.getBoundingClientRect();
                    let foundRow = rows.find(r => Math.abs(r.top - rect.top) < 8);
                    if (!foundRow) {
                        foundRow = { top: rect.top, cards: [] };
                        rows.push(foundRow);
                    }
                    foundRow.cards.push(card);
                });

                rows.sort((a, b) => a.top - b.top);

                const isDesktop = (typeof isMobileDevice === 'function' ? !isMobileDevice() : true) && window.innerWidth > 768;

                if ((isDesktop || rows.length === 2) && rows.length >= 2) {
                    // 桌面设备下：停留位置在两排卡片的水平中间位置（第一排与第二排之间，水平垂直双向居中）
                    const row1Top = Math.min(...rows[0].cards.map(c => c.getBoundingClientRect().top));
                    const row2Bottom = Math.max(...rows[1].cards.map(c => c.getBoundingClientRect().bottom));
                    targetY = (row1Top + row2Bottom) / 2;

                    const allVisibleCards = [...rows[0].cards, ...rows[1].cards];
                    const minLeft = Math.min(...allVisibleCards.map(c => c.getBoundingClientRect().left));
                    const maxRight = Math.max(...allVisibleCards.map(c => c.getBoundingClientRect().right));
                    if (maxRight > minLeft) {
                        targetX = (minLeft + maxRight) / 2;
                    }
                } else {
                    // 移动端等单列布局场景：锁定在指定行卡片中心（默认第二行）
                    const targetRow = rows.length > 1 ? rows[1] : rows[0];
                    const sampleCard = targetRow.cards[0];
                    const cardRect = sampleCard.getBoundingClientRect();
                    targetY = cardRect.top + cardRect.height / 2;
                }
            } else {
                const rect = stack.getBoundingClientRect();
                if (rect.height > 0) {
                    targetY = rect.top + rect.height / 2;
                }
            }

            // 视口安全范围限制（避免异常情况下跑出视口外）
            const minY = window.innerHeight * 0.15;
            const maxY = window.innerHeight * 0.85;
            targetY = Math.max(minY, Math.min(maxY, targetY));
        }

        const startY = window.innerHeight + 160;
        const exitY = -200;

        const card = document.createElement('div');
        card.className = `speed-toast-card speed-toast-${type || 'noble'}`;
        card.style.setProperty('--target-x', `${targetX}px`);
        card.style.setProperty('--start-y', `${startY}px`);
        card.style.setProperty('--target-y', `${targetY}px`);
        card.style.setProperty('--exit-y', `${exitY}px`);

        card.innerHTML = `
            <div class="speed-toast-streaks" aria-hidden="true">
                <span class="speed-streak line-1"></span>
                <span class="speed-streak line-2"></span>
                <span class="speed-streak line-3"></span>
                <span class="speed-streak line-4"></span>
            </div>
            <div class="speed-toast-ghost ghost-4" aria-hidden="true">${text}</div>
            <div class="speed-toast-ghost ghost-3" aria-hidden="true">${text}</div>
            <div class="speed-toast-ghost ghost-2" aria-hidden="true">${text}</div>
            <div class="speed-toast-ghost ghost-1" aria-hidden="true">${text}</div>
            <div class="speed-toast-text">${text}</div>
        `;

        overlay.appendChild(card);

        // 动效全长 1.00s（进场0.3s，停留0.4s，离场0.3s），结束后安全清理 DOM
        activeSpeedToastTimer = setTimeout(() => {
            dismissCategorySpeedToast();
        }, 1050);
    }

    window.triggerCategorySpeedToast = triggerCategorySpeedToast;
    window.dismissCategorySpeedToast = dismissCategorySpeedToast;
    window.speedToastCounts = speedToastCounts;

    // 4. 初始化分类切换过滤器
    function initCategoryFilter() {
        const navButtons = Array.from(document.querySelectorAll('.category-btn'));
        const container = document.querySelector('.button-stack');
        const expandWrapper = document.getElementById('expandBtnWrapper');
        if (!container || !navButtons.length) return;

        const categoryPathMap = {
            'noble': '/old',
            'airport': '/',
            'vps': '/vps'
        };

        function getCategoryFromLocation() {
            const pathSlug = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase().split('/')[0];
            const hash = (window.location.hash || '').toLowerCase();

            // 1. 优先满足老站与VPS的专用链接（/old, /vps 以及对应的 Hash 锚点），不受随机规则约束
            if (pathSlug === 'old' || hash === '#noble' || hash === '#lz' || hash === '#old' || hash === '#gz') {
                return 'noble';
            } else if (pathSlug === 'vps' || hash === '#vps') {
                return 'vps';
            } else if (hash === '#airport' || hash === '#young') {
                return 'airport';
            }

            // 2. 检查由 <head> 脚本预先解析并设定的初始目标分类（避免重复随机）
            if (window.__INITIAL_CATEGORY__) {
                const initCat = window.__INITIAL_CATEGORY__;
                window.__INITIAL_CATEGORY__ = null; // 消费后清除，避免干扰后续历史导航
                return initCat;
            }

            // 3. 兜底保护：若未执行过首屏解析（如外部直访根路径），按 15% 老站 / 15% VPS / 70% 机场概率分流
            if (!window.__INITIAL_CATEGORY_RESOLVED__ && (pathSlug === '' || pathSlug === 'index.html')) {
                window.__INITIAL_CATEGORY_RESOLVED__ = true;
                const r = Math.random();
                if (r < 0.15) {
                    return 'noble';
                } else if (r < 0.30) {
                    return 'vps';
                }
                return 'airport';
            }

            return 'airport';
        }

        let activeCategory = getCategoryFromLocation();

        // 若初始 URL 为 Hash 访问或发生分流跳转，规范化清洗为对应路径 /old, /, /vps (保持 search 参数)
        try {
            const initialHash = (window.location.hash || '').toLowerCase();
            const search = window.location.search || '';
            if (initialHash === '#old' || initialHash === '#noble' || initialHash === '#lz' || initialHash === '#gz' || activeCategory === 'noble') {
                if (window.location.pathname !== '/old') {
                    history.replaceState({ category: 'noble', type: 'category' }, '', '/old' + search);
                }
            } else if (initialHash === '#young' || initialHash === '#airport' || activeCategory === 'airport') {
                if (initialHash && window.location.pathname !== '/') {
                    history.replaceState({ category: 'airport', type: 'category' }, '', '/' + search);
                }
            } else if (initialHash === '#vps' || activeCategory === 'vps') {
                if (window.location.pathname !== '/vps') {
                    history.replaceState({ category: 'vps', type: 'category' }, '', '/vps' + search);
                }
            }
        } catch (e) {}

        // 严格同步 body 属性，驱动 CSS 级严格隔离
        document.body.dataset.activeCategory = activeCategory;

        function updateCardVisibility(withAnimation = false) {
            const isExpanded = container.classList.contains('is-expanded');
            const allButtons = Array.from(container.querySelectorAll('.button'));

            let visibleHiddenCount = 0;
            const buttonsToAnimate = [];

            allButtons.forEach(btn => {
                const btnCat = btn.dataset.category;
                // 同一分类下，只可以显示所属分类的卡片，严禁跨分类展示
                const matchesCategory = (btnCat === activeCategory);
                const isCardHidden = btn.classList.contains('card-hidden');

                if (matchesCategory) {
                    const isMultiLine = btn.classList.contains('has-desc') || Boolean(btn.querySelector('.card-desc'));
                    const displayVal = isMultiLine ? 'flex' : 'inline-flex';
                    if (isCardHidden) {
                        visibleHiddenCount++;
                        if (isExpanded) {
                            btn.style.display = displayVal;
                            btn.classList.remove('category-filtered-out');
                            if (withAnimation) buttonsToAnimate.push(btn);
                        } else {
                            btn.style.display = 'none';
                            btn.classList.remove('category-filtered-out');
                        }
                    } else {
                        btn.style.display = displayVal;
                        btn.classList.remove('category-filtered-out');
                        if (withAnimation) buttonsToAnimate.push(btn);
                    }
                } else {
                    btn.style.display = 'none';
                    btn.classList.add('category-filtered-out');
                }
            });

            // 优化：仅对需要渐入的按钮统一应用动画，消除每次循环调用 offsetWidth 带来的强制同步重排 (Layout Thrashing)
            if (withAnimation && buttonsToAnimate.length > 0) {
                buttonsToAnimate.forEach(b => b.classList.remove('category-fade-in'));
                // 单次触发布局重排刷新状态
                void container.offsetWidth;
                buttonsToAnimate.forEach(b => b.classList.add('category-fade-in'));
            }

            // 更新展开隐藏卡片按钮的显示状态
            if (expandWrapper) {
                expandWrapper.style.display = (visibleHiddenCount > 0) ? 'flex' : 'none';
            }

            // 切换分类到老站和VPS时，隐藏下方的指南内容模块
            const seoKnowledge = document.getElementById('seo-knowledge');
            if (seoKnowledge) {
                seoKnowledge.style.display = (activeCategory === 'noble' || activeCategory === 'vps') ? 'none' : '';
            }
            document.body.dataset.activeCategory = activeCategory;
        }

        updateCardVisibilityGlobal = updateCardVisibility;

        function setCategory(cat, updateHistory = true) {
            if (!cat || !['airport', 'noble', 'vps'].includes(cat)) return;
            if (activeCategory === cat) return;
            const prevCategory = activeCategory;
            activeCategory = cat;

            // 切换分类时同步更新 URL 路径 (HTML5 History API)
            if (updateHistory) {
                const targetPath = categoryPathMap[activeCategory];
                if (targetPath && window.location.pathname !== targetPath) {
                    try {
                        history.pushState({ category: activeCategory, type: 'category' }, '', targetPath);
                    } catch (e) {}
                }
            }

            // 切换分类时重置展开状态，保持一致的分类初始收起体验
            if (container.classList.contains('is-expanded')) {
                container.classList.remove('is-expanded');
                if (expandWrapper) expandWrapper.classList.remove('is-expanded');
                const expandBtn = document.getElementById('expandCardBtn');
                if (expandBtn) {
                    expandBtn.setAttribute('aria-expanded', 'false');
                    expandBtn.setAttribute('title', '展开更多');
                    expandBtn.setAttribute('aria-label', '展开更多');
                }
            }

            document.body.dataset.activeCategory = activeCategory;

            navButtons.forEach(btn => {
                const btnCat = btn.dataset.category;
                const isActive = (btnCat === activeCategory);
                btn.classList.toggle('is-active', isActive);
                btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });

            updateCardVisibility(true);
            updateGuideCategory(activeCategory);

            // 切换分类时，左上角的指南按钮对应快速高亮一下（柔和流畅）
            if (prevCategory !== activeCategory) {
                highlightGuideButton();
            }

            // 触发分类切换极速拖影动效（老站：“省心”，VPS：“不难”，机场：“家宽”）
            if (prevCategory !== activeCategory) {
                if (activeCategory === 'noble') {
                    triggerCategorySpeedToast('省心', 'noble');
                } else if (activeCategory === 'vps') {
                    triggerCategorySpeedToast('不难', 'vps');
                } else if (activeCategory === 'airport') {
                    triggerCategorySpeedToast('家宽', 'airport');
                } else {
                    dismissCategorySpeedToast();
                }
            }
        }

        navButtons.forEach(btn => {
            const isActive = (btn.dataset.category === activeCategory);
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (document.body.classList.contains('cards-falling')) return;
                if (btn.dataset.category === activeCategory) return;
                setCategory(btn.dataset.category, true);
            });
        });

        // 监听浏览器前进后退，支持不同分类间无刷新无缝切换
        window.addEventListener('popstate', () => {
            const targetCat = getCategoryFromLocation();
            if (targetCat !== activeCategory) {
                setCategory(targetCat, false);
            }
        });

        // 监听 URL hash 变化，支持传统锚点深度链接
        window.addEventListener('hashchange', () => {
            const targetCat = getCategoryFromLocation();
            if (targetCat !== activeCategory) {
                setCategory(targetCat, false);
            }
        });

        updateCardVisibility(false);
        updateGuideCategory(activeCategory);
    }

    // 5. 初始化展开/收起隐藏卡片按钮
    function initExpandButton() {
        const container = document.querySelector('.button-stack');
        const wrapper = document.getElementById('expandBtnWrapper');
        const btn = document.getElementById('expandCardBtn');
        if (!container || !wrapper || !btn) return;

        function toggleExpand() {
            const isExpanded = container.classList.toggle('is-expanded');
            wrapper.classList.toggle('is-expanded', isExpanded);
            btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            btn.setAttribute('title', isExpanded ? '收起卡片' : '展开更多');
            btn.setAttribute('aria-label', isExpanded ? '收起卡片' : '展开更多');
            if (updateCardVisibilityGlobal) {
                updateCardVisibilityGlobal(false);
            }
        }

        btn.addEventListener('click', toggleExpand);
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleExpand();
            }
        });
    }

    // 6. 初始化卡片内部右侧二维码图标与悬浮展示逻辑（优化：按需懒渲染）
    function initCardQRCodes() {
        const buttons = document.querySelectorAll('.button-stack .button');
        if (!buttons.length) return;

        buttons.forEach(btn => {
            const href = btn.getAttribute('href');
            if (!href || href === '#' || href.startsWith('javascript:')) return;
            if (btn.querySelector('.qr-trigger')) return;

            // 创建卡片内右侧二维码图标按钮
            const trigger = document.createElement('span');
            trigger.className = 'qr-trigger';
            trigger.setAttribute('role', 'button');
            trigger.setAttribute('aria-label', '查看手机二维码');
            trigger.setAttribute('tabindex', '0');
            trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2h8v8H2V2zm2 2v4h4V4H4zm1 1h2v2H5V5zm9-3h8v8h-8V2zm2 2v4h4V4h-4zm1 1h2v2h-2V5zM2 14h8v8H2v-8zm2 2v4h4v-4H4zm1 1h2v2H5v-2zm9-2h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2zm2-2h2v2h-2v-2zm-6 4h4v2h-4v-2zm4 0h2v2h-2v-2zm-6-6h2v2h-2v-2zm2 2h2v2h-2v-2z"/></svg>';

            // 创建卡片上方浮动的磨砂玻璃二维码弹窗
            const popup = document.createElement('div');
            popup.className = 'qr-popup';
            popup.setAttribute('role', 'tooltip');
            popup.innerHTML = `
                <div class="qr-popup-card">
                    <div class="qr-code-box"></div>
                    <div class="qr-caption" role="button" tabindex="0" title="点击复制链接">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        <span>点击复制链接</span>
                    </div>
                </div>
                <div class="qr-arrow"></div>
            `;

            // 点击复制链接交互逻辑
            const caption = popup.querySelector('.qr-caption');
            if (caption) {
                const captionText = caption.querySelector('span');
                const copySvgHTML = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>';
                const checkSvgHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
                let copyTimer = null;

                const copyLink = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    let urlToCopy = btn.href || href;
                    if (window.location.hostname !== 'jiakuan.link') {
                        const m = urlToCopy.match(/^https?:\/\/jiakuan\.link\/([a-z0-9_-]+)/i) || urlToCopy.match(/^\/([a-z0-9_-]+)/i);
                        if (m) {
                            const currentOrigin = window.location.origin || `${window.location.protocol}//${window.location.host}`;
                            urlToCopy = `${currentOrigin}/${m[1].toLowerCase()}`;
                        }
                    }
                    try {
                        if (navigator.clipboard && window.isSecureContext) {
                            await navigator.clipboard.writeText(urlToCopy);
                        } else {
                            const textarea = document.createElement('textarea');
                            textarea.value = urlToCopy;
                            textarea.style.position = 'fixed';
                            textarea.style.left = '-9999px';
                            document.body.appendChild(textarea);
                            textarea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textarea);
                        }
                        const svgEl = caption.querySelector('svg');
                        if (captionText) {
                            captionText.textContent = '已复制链接';
                            caption.classList.add('copied');
                            if (svgEl) svgEl.innerHTML = checkSvgHTML;
                            clearTimeout(copyTimer);
                            copyTimer = setTimeout(() => {
                                captionText.textContent = '点击复制链接';
                                caption.classList.remove('copied');
                                if (svgEl) svgEl.innerHTML = copySvgHTML;
                            }, 1500);
                        }
                    } catch (err) {
                        console.error('复制失败', err);
                    }
                };

                caption.addEventListener('click', copyLink);
                caption.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        copyLink(e);
                    }
                });
            }

            // 按需惰性渲染二维码：只在用户首次交互（鼠标移入、聚焦或点击）时生成，避免启动时执行 40 次密集 QRCode 运算
            let qrRendered = false;
            function renderQRCodeOnce() {
                if (qrRendered) return;
                qrRendered = true;
                const codeBox = popup.querySelector('.qr-code-box');
                if (codeBox && typeof QRCode !== 'undefined') {
                    let qrUrl = href;
                    if (window.location.hostname !== 'jiakuan.link') {
                        const m = qrUrl.match(/^https?:\/\/jiakuan\.link\/([a-z0-9_-]+)/i) || qrUrl.match(/^\/([a-z0-9_-]+)/i);
                        if (m) {
                            const currentOrigin = window.location.origin || `${window.location.protocol}//${window.location.host}`;
                            qrUrl = `${currentOrigin}/${m[1].toLowerCase()}`;
                        }
                    }
                    new QRCode(codeBox, {
                        text: qrUrl,
                        width: 112,
                        height: 112,
                        colorDark: "#0f172a",
                        colorLight: "#ffffff",
                        correctLevel: QRCode.CorrectLevel.M
                    });
                    codeBox.removeAttribute('title');
                    const img = codeBox.querySelector('img');
                    if (img) {
                        img.removeAttribute('title');
                        img.alt = '二维码';
                    }
                }
            }

            trigger.addEventListener('mouseenter', renderQRCodeOnce, { passive: true });
            trigger.addEventListener('focus', renderQRCodeOnce, { passive: true });

            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                renderQRCodeOnce();
                const wasActive = btn.classList.contains('qr-active');
                document.querySelectorAll('.button.qr-active').forEach(b => {
                    if (b !== btn) b.classList.remove('qr-active');
                });
                btn.classList.toggle('qr-active', !wasActive);
            });

            trigger.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    trigger.click();
                }
            });

            popup.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });

            btn.appendChild(trigger);
            btn.appendChild(popup);
        });

        // 点击空白处或 Esc 关闭弹窗
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.qr-popup') && !e.target.closest('.qr-trigger')) {
                document.querySelectorAll('.button.qr-active').forEach(b => b.classList.remove('qr-active'));
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.button.qr-active').forEach(b => b.classList.remove('qr-active'));
            }
        });
    }

    // 7. 设备判定与全屏四边动态 Emoji 飞行引擎 (Unicode 全套 Emoji)
    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent)
            || (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024)
            || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 1024);
    }

    let emojiFlightController = null;

    function initEmojiFlight() {
        if (emojiFlightController) {
            emojiFlightController.start();
            return emojiFlightController;
        }

        const wrapper = document.querySelector('.airplane-wrapper');
        const flyer = document.querySelector('.airplane');
        if (!wrapper || !flyer) return null;

        // 默认精选备用 Emoji 列表（如果 emoji-data.js 仍在异步加载中）
        const fallbackEmojis = [
            '✈️','🚀','🛸','🎈','🚁','✨','🌟','🌈','🦄','🦅','🦋','🐱','🐶','🦊','🐼',
            '🦁','🐯','🐵','🦉','🐣','🐬','🐳','🐙','🌸','🌻','🍀','🍉','🍓','🍒','🍔',
            '🍕','🍦','🍩','⚽','🏀','🎮','🎸','🎨','🏆','👑','💎','🔥','⚡','💫','🪐',
            '🌙','☀️','☁️','🎉','🍿'
        ];

        function getRandomEmoji() {
            const list = (window.__ALL_EMOJIS__ && window.__ALL_EMOJIS__.length > 0)
                ? window.__ALL_EMOJIS__
                : fallbackEmojis;
            return list[Math.floor(Math.random() * list.length)];
        }

        let isRunning = false;
        let isPaused = false;
        let animFrameId = null;
        let nextFlightTimer = null;
        let isWaitingNext = false;

        let startPos = { x: 0, y: 0 };
        let targetPos = { x: 0, y: 0 };
        let flightDistance = 1000;
        let flightDuration = 18000;
        let flightStartTime = 0;
        let pauseTime = 0;
        let unitNormal = { x: 0, y: 1 };
        let waveDirection = 1;

        // 随机选择四边起点与终点，严格避开四个角，保证 emoji 始终完整显示且可向上或跨屏飞行
        function chooseFlightPath() {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const isMobile = w <= 768 || isMobileDevice();
            const size = isMobile ? 32 : 48;
            const extraOffset = size + 15; // 确保完全离开视口边缘消失且留出微量缓冲

            // 避开浏览器四个角的安全保护边距（至少为尺寸的 1.6 倍且占视口 15% 以上，防止四角被遮挡或截断）
            const marginX = Math.max(size * 1.6, Math.min(w * 0.18, 220));
            const marginY = Math.max(size * 1.6, Math.min(h * 0.18, 200));

            const edges = ['left', 'right', 'top', 'bottom'];
            const startEdge = edges[Math.floor(Math.random() * edges.length)];
            const availableTargets = edges.filter(e => e !== startEdge);
            const targetEdge = availableTargets[Math.floor(Math.random() * availableTargets.length)];

            function getEdgePoint(edge) {
                let x = 0;
                let y = 0;
                if (edge === 'left') {
                    x = -extraOffset;
                    const availH = Math.max(0, h - 2 * marginY - size);
                    y = marginY + Math.random() * availH;
                } else if (edge === 'right') {
                    x = w + 15;
                    const availH = Math.max(0, h - 2 * marginY - size);
                    y = marginY + Math.random() * availH;
                } else if (edge === 'top') {
                    const availW = Math.max(0, w - 2 * marginX - size);
                    x = marginX + Math.random() * availW;
                    y = -extraOffset;
                } else if (edge === 'bottom') {
                    const availW = Math.max(0, w - 2 * marginX - size);
                    x = marginX + Math.random() * availW;
                    y = h + 15;
                }
                return { x, y };
            }

            const p0 = getEdgePoint(startEdge);
            const p1 = getEdgePoint(targetEdge);

            const dx = p1.x - p0.x;
            const dy = p1.y - p0.y;
            const dist = Math.hypot(dx, dy) || 1;

            // 飞行速度保持与原飞机动画一致（约 60-70px/s）
            const speed = isMobile ? 45 : 65;
            const duration = Math.max(8000, (dist / speed) * 1000);

            return {
                startPos: p0,
                targetPos: p1,
                dist,
                duration,
                unitNormal: { x: -dy / dist, y: dx / dist },
                waveDirection: Math.random() < 0.5 ? 1 : -1,
                size,
                w,
                h
            };
        }

        function startNewFlight() {
            if (isPaused) return;
            isWaitingNext = false;
            if (nextFlightTimer) {
                clearTimeout(nextFlightTimer);
                nextFlightTimer = null;
            }

            // 每次飞行随机选取一个 Unicode Emoji
            const emoji = getRandomEmoji();
            flyer.textContent = emoji;

            const path = chooseFlightPath();
            startPos = path.startPos;
            targetPos = path.targetPos;
            flightDistance = path.dist;
            flightDuration = path.duration;
            unitNormal = path.unitNormal;
            waveDirection = path.waveDirection;

            flightStartTime = performance.now();
            pauseTime = 0;

            wrapper.style.transform = `translate3d(${startPos.x}px, ${startPos.y}px, 0)`;
            wrapper.classList.add('flight-active');
            updateFlightFrame(performance.now());
        }

        function updateFlightFrame(now) {
            if (isPaused) return;

            const elapsed = now - flightStartTime;
            let t = elapsed / flightDuration;

            if (t >= 1) {
                // 当前飞行中的 emoji 已经完全离开浏览器视口边缘并消失
                if (animFrameId) {
                    cancelAnimationFrame(animFrameId);
                    animFrameId = null;
                }
                wrapper.classList.remove('flight-active');
                wrapper.style.transform = `translate3d(${targetPos.x}px, ${targetPos.y}px, 0)`;

                // 待当前 emoji 完全消失在边缘后，再出现下一个 emoji 开始飞行
                isWaitingNext = true;
                nextFlightTimer = setTimeout(() => {
                    if (!isPaused) {
                        startNewFlight();
                    }
                }, 600);
                return;
            }

            // 飞行轨迹：基础线性位移 + 经典原版正弦起伏（保持与原飞机 50% 时约 20px 摆动一致）
            const baseX = startPos.x + t * (targetPos.x - startPos.x);
            const baseY = startPos.y + t * (targetPos.y - startPos.y);

            // 正弦波在两端 t=0 与 t=1 处为 0，触碰边缘时坐标绝对精准
            const wave = waveDirection * 20 * Math.sin(Math.PI * t);
            let posX = baseX + wave * unitNormal.x;
            let posY = baseY + wave * unitNormal.y;

            // 微幅自然倾角晃动（±2.5度），模拟空气悬浮动作，保持直立易于辨识
            const angleDeg = 2.5 * Math.sin(Math.PI * 4 * t);

            wrapper.style.transform = `translate3d(${posX}px, ${posY}px, 0) rotate(${angleDeg}deg)`;

            animFrameId = requestAnimationFrame(updateFlightFrame);
        }

        function start() {
            if (isRunning) return;
            isRunning = true;
            isPaused = false;
            startNewFlight();
        }

        function pause() {
            if (isPaused) return;
            isPaused = true;
            pauseTime = performance.now();
            if (animFrameId) {
                cancelAnimationFrame(animFrameId);
                animFrameId = null;
            }
            if (nextFlightTimer) {
                clearTimeout(nextFlightTimer);
                nextFlightTimer = null;
            }
        }

        function resume() {
            if (!isPaused) return;
            isPaused = false;
            if (isWaitingNext) {
                // 暂停期间若处于前一个完全消失后的等待间隙，直接拉起下一个
                startNewFlight();
            } else if (pauseTime > 0) {
                flightStartTime += (performance.now() - pauseTime);
                pauseTime = 0;
                animFrameId = requestAnimationFrame(updateFlightFrame);
            } else {
                flightStartTime = performance.now();
                animFrameId = requestAnimationFrame(updateFlightFrame);
            }
        }

        // 页面可见性监控：防止切换后台时产生跳帧
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (!isPaused) pause();
            } else {
                if (isPaused && (!window.__isPhysicsActive || !window.__isPhysicsActive())) {
                    resume();
                }
            }
        });

        emojiFlightController = {
            start,
            pause,
            resume,
            startNewFlight
        };

        window.__emojiFlight = emojiFlightController;

        if (document.readyState === 'complete') {
            start();
        } else {
            window.addEventListener('load', start, { once: true });
        }

        return emojiFlightController;
    }

    // 8. 桌面端物理掉落与时光倒流彩蛋（空闲惰性加载 Matter.js，不阻塞首屏）
    let physicsInitialized = false;

    function initDesktopPhysics() {
        if (physicsInitialized) return;
        const airplane = document.querySelector('.airplane');
        if (!airplane || typeof Matter === 'undefined') return;
        physicsInitialized = true;

        let hasCrashed = false;
        let cardsFallen = false;
        let isRewinding = false;
        let lastCrashTime = 0;
        window.__isPhysicsActive = () => hasCrashed;

        let engine, world, runner;
        let ground, topWall, leftWall, rightWall;
        const domBodies = [];

        function initPhysics() {
            if (engine) {
                Matter.World.clear(engine.world);
                Matter.Engine.clear(engine);
                if (runner) Matter.Runner.stop(runner);
            }

            const Engine = Matter.Engine,
                World = Matter.World,
                Bodies = Matter.Bodies,
                Runner = Matter.Runner;

            engine = Engine.create();
            world = engine.world;
            engine.gravity.x = 0;
            engine.gravity.y = 1;

            const w = window.innerWidth;
            const h = window.innerHeight;
            const thickness = 100;
            ground = Bodies.rectangle(w / 2, h + thickness / 2, w + 400, thickness, { isStatic: true, friction: 0.8 });
            topWall = Bodies.rectangle(w / 2, -thickness / 2, w + 400, thickness, { isStatic: true, friction: 0.8 });
            leftWall = Bodies.rectangle(-thickness / 2, h / 2, thickness, h * 2 + 400, { isStatic: true, friction: 0.8 });
            rightWall = Bodies.rectangle(w + thickness / 2, h / 2, thickness, h * 2 + 400, { isStatic: true, friction: 0.8 });

            World.add(world, [ground, topWall, leftWall, rightWall]);

            Matter.Events.on(engine, 'afterUpdate', () => {
                if (isRewinding) return;
                for (let db of domBodies) {
                    const { body, el, width, height, history } = db;
                    const mainPart = body.parts.length > 1 ? body.parts[1] : body;
                    const x = mainPart.position.x - width / 2;
                    const y = mainPart.position.y - height / 2;

                    el.style.transform = `translate(${x}px, ${y}px) rotate(${body.angle}rad)`;
                    history.push({ x, y, angle: body.angle });
                }
            });

            runner = Runner.create();
            Runner.run(runner, engine);
        }

        window.addEventListener('resize', () => {
            if (!engine || !world || !ground || !topWall || !leftWall || !rightWall) return;
            const w = window.innerWidth;
            const h = window.innerHeight;
            const thickness = 100;
            Matter.Body.setPosition(ground, { x: w / 2, y: h + thickness / 2 });
            Matter.Body.setPosition(topWall, { x: w / 2, y: -thickness / 2 });
            Matter.Body.setPosition(leftWall, { x: -thickness / 2, y: h / 2 });
            Matter.Body.setPosition(rightWall, { x: w + thickness / 2, y: h / 2 });
        }, { passive: true });

        function addDomBodyWithRect(el, rect, options = {}) {
            const xCenter = rect.left + rect.width / 2;
            const yCenter = rect.top + rect.height / 2;

            const isFixed = window.getComputedStyle(el).position === 'fixed';
            let placeholder = null;
            if (!isFixed) {
                placeholder = document.createElement('div');
                placeholder.style.width = rect.width + 'px';
                placeholder.style.height = rect.height + 'px';
                el.parentNode.insertBefore(placeholder, el);
            }

            document.body.appendChild(el);

            el.style.position = 'fixed';
            el.style.left = '0';
            el.style.top = '0';
            el.style.margin = '0';
            el.style.width = rect.width + 'px';
            el.style.height = rect.height + 'px';
            el.style.transition = 'none';
            el.style.animation = 'none';
            el.style.transform = `translate(${rect.left}px, ${rect.top}px)`;

            if (el.classList.contains('airplane')) {
                el.style.zIndex = '9999';
                el.style.pointerEvents = 'auto';
                el.style.cursor = 'pointer';
            } else {
                el.style.zIndex = '10';
                el.style.pointerEvents = 'auto';
                el.style.cursor = 'pointer';
            }

            const body = Matter.Bodies.rectangle(xCenter, yCenter, rect.width, rect.height, {
                restitution: 0.4,
                friction: 0.8,
                frictionAir: 0.02,
                ...options
            });

            Matter.World.add(world, body);
            domBodies.push({
                body,
                el,
                placeholder,
                width: rect.width,
                height: rect.height,
                history: [{ x: rect.left, y: rect.top, angle: 0 }]
            });
            return body;
        }

        function startRewind() {
            isRewinding = true;
            if (runner) Matter.Runner.stop(runner);

            for (let db of domBodies) {
                while (db.history.length > 20) {
                    const last = db.history[db.history.length - 1];
                    const prev = db.history[db.history.length - 2];
                    if (Math.abs(last.x - prev.x) < 0.5 && Math.abs(last.y - prev.y) < 0.5 && Math.abs(last.angle - prev.angle) < 0.01) {
                        db.history.pop();
                    } else {
                        break;
                    }
                }
            }

            const rewindFrames = 120;
            let currentFrame = 0;

            function rewindTick() {
                currentFrame++;
                const progress = currentFrame / rewindFrames;
                const easeProgress = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

                for (let db of domBodies) {
                    const hLen = db.history.length;
                    if (hLen === 0) continue;

                    if (hLen === 1) {
                        const frame = db.history[0];
                        db.el.style.transform = `translate(${frame.x}px, ${frame.y}px) rotate(${frame.angle}rad)`;
                        continue;
                    }

                    let exactIndex = (1 - easeProgress) * (hLen - 1);
                    exactIndex = Math.max(0, Math.min(hLen - 1, exactIndex));

                    const indexFloor = Math.floor(exactIndex);
                    const indexCeil = Math.ceil(exactIndex);
                    const weight = exactIndex - indexFloor;

                    const frameF = db.history[indexFloor];
                    const frameC = db.history[indexCeil];

                    const x = frameF.x * (1 - weight) + frameC.x * weight;
                    const y = frameF.y * (1 - weight) + frameC.y * weight;

                    let diff = frameC.angle - frameF.angle;
                    while (diff < -Math.PI) diff += 2 * Math.PI;
                    while (diff > Math.PI) diff -= 2 * Math.PI;
                    const angle = frameF.angle + diff * weight;

                    db.el.style.transform = `translate(${x}px, ${y}px) rotate(${angle}rad)`;
                }

                if (currentFrame < rewindFrames) {
                    requestAnimationFrame(rewindTick);
                } else {
                    restoreOriginalState();
                }
            }
            requestAnimationFrame(rewindTick);
        }

        function restoreOriginalState() {
            for (let db of domBodies) {
                const { el, placeholder } = db;

                el.style.position = '';
                el.style.left = '';
                el.style.top = '';
                el.style.margin = '';
                el.style.width = '';
                el.style.height = '';
                el.style.transform = '';
                el.style.transition = '';
                el.style.animation = '';
                el.style.zIndex = '';
                el.style.cursor = '';
                el.style.pointerEvents = '';

                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.replaceChild(el, placeholder);
                }
            }

            if (engine) {
                Matter.World.clear(engine.world);
                Matter.Engine.clear(engine);
            }

            const wrapper = document.querySelector('.airplane-wrapper');
            if (wrapper) wrapper.style.animationPlayState = 'running';

            domBodies.length = 0;
            document.body.classList.remove('cards-falling');
            hasCrashed = false;
            cardsFallen = false;
            isRewinding = false;
            if (updateCardVisibilityGlobal) {
                updateCardVisibilityGlobal(false);
            }

            if (window.__emojiFlight) {
                window.__emojiFlight.resume();
            }
        }

        function triggerCrash(clientX, clientY) {
            if (hasCrashed) return;
            hasCrashed = true;
            lastCrashTime = Date.now();

            if (window.__emojiFlight) {
                window.__emojiFlight.pause();
            }

            const wrapper = airplane.parentElement;
            if (wrapper && wrapper.classList.contains('airplane-wrapper')) {
                wrapper.style.animationPlayState = 'paused';
            }

            const rect = airplane.getBoundingClientRect();

            initPhysics();
            airplane.style.transition = 'none';
            const planeBody = addDomBodyWithRect(airplane, rect, {
                density: 0.05,
                restitution: 0.15,
                friction: 0.8,
                frictionAir: 0.02
            });

            Matter.Body.setVelocity(planeBody, { x: 0, y: 0 });
            Matter.Body.setAngularVelocity(planeBody, 0.01);
            Matter.Body.setAngle(planeBody, 0);
        }

        function handleAirplaneClick(e) {
            if (!hasCrashed) {
                triggerCrash(e ? e.clientX : undefined, e ? e.clientY : undefined);
                return;
            }
            if (Date.now() - lastCrashTime < 350) return;
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            if (!cardsFallen) {
                cardsFallen = true;
                document.body.classList.add('cards-falling');
                const cardsArray = Array.from(document.querySelectorAll('.button')).filter(card => {
                    return window.getComputedStyle(card).display !== 'none';
                });

                for (let i = cardsArray.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [cardsArray[i], cardsArray[j]] = [cardsArray[j], cardsArray[i]];
                }

                cardsArray.forEach((card, i) => {
                    setTimeout(() => {
                        const rect = card.getBoundingClientRect();
                        const body = addDomBodyWithRect(card, rect, { density: 0.005, restitution: 0.2 });

                        const offsetX = (Math.random() - 0.5) * rect.width;
                        const offsetY = (Math.random() - 0.5) * rect.height;
                        const forcePosition = {
                            x: body.position.x + offsetX,
                            y: body.position.y + offsetY
                        };

                        const forceMagnitude = body.mass * (0.001 + Math.random() * 0.002);
                        const forceAngle = Math.PI / 4 + Math.random() * (Math.PI / 2);

                        const forceVector = {
                            x: forceMagnitude * Math.cos(forceAngle),
                            y: forceMagnitude * Math.sin(forceAngle)
                        };

                        Matter.Body.applyForce(body, forcePosition, forceVector);
                    }, i * 120);
                });
            } else if (!isRewinding) {
                startRewind();
            }
        }

        function handleCardClick(e) {
            if (cardsFallen && isRewinding) {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }

            // 多域名自适应：如果当前访问的域名不是主域名 jiakuan.link（如 jkdh.pages.dev, jkdh.sld.tw, jk.bxkp.org 或本地开发）
            // 确保在新标签页使用当前域名的短链（如 https://jkdh.pages.dev/rancho），避免依赖外部可能受阻的主域名
            if (window.location.hostname !== 'jiakuan.link') {
                const cardEl = this || (e && e.currentTarget);
                const href = cardEl ? cardEl.getAttribute('href') : '';
                if (href) {
                    const m = href.match(/^https?:\/\/jiakuan\.link\/([a-z0-9_-]+)/i) || href.match(/^\/([a-z0-9_-]+)/i);
                    if (m) {
                        const slug = m[1].toLowerCase();
                        if (e) e.preventDefault();
                        const isLocal = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1 || window.location.protocol === 'file:';
                        if (isLocal && window.__SHORTLINK_MAP__ && window.__SHORTLINK_MAP__[slug]) {
                            window.open(window.__SHORTLINK_MAP__[slug], '_blank', 'noopener,noreferrer');
                        } else {
                            const currentOrigin = window.location.origin || `${window.location.protocol}//${window.location.host}`;
                            window.open(`${currentOrigin}/${slug}`, '_blank', 'noopener,noreferrer');
                        }
                    }
                }
            }
        }

        airplane.addEventListener('mouseenter', (event) => {
            triggerCrash(event.clientX, event.clientY);
        });
        airplane.addEventListener('click', handleAirplaneClick);

        document.querySelectorAll('.button').forEach(btn => {
            btn.addEventListener('click', handleCardClick);
        });
    }

    // 调度 Matter.js：采用 requestIdleCallback 空闲加载，若用户悬停飞机则立即加载
    function loadMatterJs() {
        if (isMobileDevice() || typeof Matter !== 'undefined') {
            if (typeof Matter !== 'undefined') initDesktopPhysics();
            return;
        }

        let scriptRequested = false;
        function loadScript() {
            if (scriptRequested || typeof Matter !== 'undefined') return;
            scriptRequested = true;
            const matterScript = document.createElement('script');
            matterScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';
            matterScript.onload = () => {
                initDesktopPhysics();
            };
            document.head.appendChild(matterScript);
        }

        const airplane = document.querySelector('.airplane');
        if (airplane) {
            airplane.addEventListener('mouseenter', loadScript, { once: true, passive: true });
            airplane.addEventListener('click', loadScript, { once: true, passive: true });
        }

        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(loadScript, { timeout: 2500 });
        } else {
            setTimeout(loadScript, 1200);
        }
    }

    // 9. 网页空白处快速连续点击5次直达内容管理后台 (CMS) 彩蛋
    let isSecretEntranceInitialized = false;

    function initCmsSecretEntrance() {
        if (isSecretEntranceInitialized) return;
        isSecretEntranceInitialized = true;

        let clickTimestamps = [];
        let resetTimer = null;
        const TARGET_CLICKS = 5;
        const MAX_CLICK_INTERVAL = 450; // 单次连击最大允许间隔 (毫秒)
        const MAX_TOTAL_DURATION = 1600; // 5次连击最大总耗时 (毫秒)

        function resetClicks() {
            clickTimestamps = [];
            if (resetTimer) {
                clearTimeout(resetTimer);
                resetTimer = null;
            }
        }

        document.addEventListener('click', (e) => {
            // 仅响应鼠标主键（左键）或触控点击
            if (e.button !== 0) return;

            // 若弹窗打开或点击了可交互元素，立即重置计数
            if (document.body.classList.contains('guide-modal-open')) {
                resetClicks();
                return;
            }

            // 判断点击目标是否属于可交互元素或组件
            const interactiveElement = e.target.closest(
                'a, button, input, textarea, select, option, summary, dialog, [role="button"], [role="link"], [role="tab"], .button, .airplane, .airplane-wrapper, .guide-modal-content, .card-link-popup'
            );

            // 若点击了可交互元素，立即重置计数
            if (interactiveElement) {
                resetClicks();
                return;
            }

            const now = Date.now();

            // 若距离上次点击超过最大允许单次间隔，则重置连击计数
            if (clickTimestamps.length > 0) {
                const lastClick = clickTimestamps[clickTimestamps.length - 1];
                if (now - lastClick > MAX_CLICK_INTERVAL) {
                    resetClicks();
                }
            }

            if (resetTimer) {
                clearTimeout(resetTimer);
            }

            clickTimestamps.push(now);

            // 设置超时自动重置定时器
            resetTimer = setTimeout(resetClicks, MAX_CLICK_INTERVAL);

            // 判断是否达到目标连击次数（必须快速连续点击5次）
            if (clickTimestamps.length >= TARGET_CLICKS) {
                const firstClick = clickTimestamps[0];
                const totalDuration = now - firstClick;
                resetClicks();

                // 严格校验总跨度时间，必须是快速连续点击
                if (totalDuration <= MAX_TOTAL_DURATION) {
                    // 清除多次连击可能产生的文本选中高亮
                    try {
                        if (window.getSelection) {
                            window.getSelection().removeAllRanges();
                        }
                    } catch (_) {}

                    // 在新标签页打开后台内容管理页面：域名/dtms/
                    const origin = window.location.origin || `${window.location.protocol}//${window.location.host}`;
                    const targetUrl = `${origin}/dtms/`;

                    const newWindow = window.open(targetUrl, '_blank');

                    // 针对部分浏览器拦截 window.open 的兜底容灾处理
                    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
                        const fallbackLink = document.createElement('a');
                        fallbackLink.href = targetUrl;
                        fallbackLink.target = '_blank';
                        fallbackLink.rel = 'noopener noreferrer';
                        document.body.appendChild(fallbackLink);
                        fallbackLink.click();
                        document.body.removeChild(fallbackLink);
                    }
                }
            }
        }, true);
    }

    // 10. 初始化底部页角备用网址随机分流逻辑（https://jkdh.pages.dev/ 与 https://jkdh.sld.tw/ 打开概率各为 50%）
    function initBackupUrl() {
        const backupLink = document.getElementById('backup-site-link') ||
            document.querySelector('.middle-footer a[href*="jkdh"]') ||
            Array.from(document.querySelectorAll('.middle-footer a')).find(a => a.textContent.trim() === '备用网址');
        if (!backupLink) return;

        const BACKUP_URLS = [
            'https://jkdh.pages.dev/',
            'https://jkdh.sld.tw/'
        ];

        function getRandomBackupUrl() {
            return BACKUP_URLS[Math.random() < 0.5 ? 0 : 1];
        }

        let lastActionTime = 0;
        function updateRandomUrl() {
            const now = Date.now();
            if (now - lastActionTime > 200) {
                lastActionTime = now;
                backupLink.href = getRandomBackupUrl();
            }
        }

        // 页面初始化或唤醒时随机选定一个初始目标
        backupLink.href = getRandomBackupUrl();

        if (backupLink.dataset.backupInitialized === 'true') return;
        backupLink.dataset.backupInitialized = 'true';

        // 鼠标按下 / 触摸开始时选定
        backupLink.addEventListener('pointerdown', updateRandomUrl);
        // 主点击事件（覆盖键盘回车激活与常规左键点击）
        backupLink.addEventListener('click', updateRandomUrl);
        // 鼠标中键（在新后台标签页打开）
        backupLink.addEventListener('auxclick', (e) => {
            if (e.button === 1) updateRandomUrl();
        });
        // 右键菜单打开前更新链接，确保复制链接地址或新标签打开准确
        backupLink.addEventListener('contextmenu', updateRandomUrl);
    }

    // 全局初始化入口（供 SPA 路由返回主页时唤醒交互）
    window.__initHomePageInteractive = function () {
        initGuideModal();
        initGuideArrowPrompt();
        initAndSortButtons();
        initCategoryFilter();
        initExpandButton();
        initCardQRCodes();
        initEmojiFlight();
        initBackupUrl();
        if (typeof Matter !== 'undefined') {
            initDesktopPhysics();
        } else {
            loadMatterJs();
        }
    };

    // 页面加载就绪后统一启动
    function bootstrap() {
        initThemeManager();
        initCmsSecretEntrance();
        window.__initHomePageInteractive();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
