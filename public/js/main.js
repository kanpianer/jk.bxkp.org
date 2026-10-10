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

        // 计算卡片第二行中心区域的物理坐标
        const stack = document.querySelector('.button-stack');
        let targetY = window.innerHeight * 0.4;
        if (stack) {
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

                // 目标位置始终锁定在第二行（若仅有一行则使用该行）
                const targetRow = rows.length > 1 ? rows[1] : rows[0];
                const sampleCard = targetRow.cards[0];
                const cardRect = sampleCard.getBoundingClientRect();
                targetY = cardRect.top + cardRect.height / 2;
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

        // 动效全长 0.80s（停留0.4s），结束后安全清理 DOM
        activeSpeedToastTimer = setTimeout(() => {
            dismissCategorySpeedToast();
        }, 850);
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

        let activeCategory = 'airport';
        const hash = window.location.hash.toLowerCase();
        if (hash === '#noble' || hash === '#lz' || hash === '#old' || hash === '#gz') {
            activeCategory = 'noble';
        } else if (hash === '#vps') {
            activeCategory = 'vps';
        } else {
            activeCategory = 'airport';
        }

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
                    if (isCardHidden) {
                        visibleHiddenCount++;
                        if (isExpanded) {
                            btn.style.display = 'inline-flex';
                            btn.classList.remove('category-filtered-out');
                            if (withAnimation) buttonsToAnimate.push(btn);
                        } else {
                            btn.style.display = 'none';
                            btn.classList.remove('category-filtered-out');
                        }
                    } else {
                        btn.style.display = 'inline-flex';
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

        function setCategory(cat) {
            if (!cat || !['airport', 'noble', 'vps'].includes(cat)) return;
            if (activeCategory === cat) return;
            const prevCategory = activeCategory;
            activeCategory = cat;

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
                setCategory(btn.dataset.category);
            });
        });

        // 监听 URL hash 变化，支持前进后退与深度链接
        window.addEventListener('hashchange', () => {
            const h = (window.location.hash || '').toLowerCase();
            let newCat = 'airport';
            if (h === '#noble' || h === '#lz' || h === '#old' || h === '#gz') {
                newCat = 'noble';
            } else if (h === '#vps') {
                newCat = 'vps';
            }
            if (newCat !== activeCategory) {
                setCategory(newCat);
            }
        });

        updateCardVisibility(false);
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
                    <div class="qr-caption">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                        <span>手机扫码直达</span>
                    </div>
                </div>
                <div class="qr-arrow"></div>
            `;

            // 按需惰性渲染二维码：只在用户首次交互（鼠标移入、聚焦或点击）时生成，避免启动时执行 40 次密集 QRCode 运算
            let qrRendered = false;
            function renderQRCodeOnce() {
                if (qrRendered) return;
                qrRendered = true;
                const codeBox = popup.querySelector('.qr-code-box');
                if (codeBox && typeof QRCode !== 'undefined') {
                    new QRCode(codeBox, {
                        text: href,
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

    // 7. 设备判定与移动端飞机飞行
    const isMobileDevice = () => {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent)
            || (navigator.maxTouchPoints > 1 && window.innerWidth <= 1024)
            || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 1024);
    };

    function initMobileAirplane() {
        const airplaneWrapper = document.querySelector('.airplane-wrapper');
        if (!airplaneWrapper) return;

        const startFlight = () => {
            if (isMobileDevice() || window.innerWidth <= 768) {
                airplaneWrapper.classList.add('mobile-flying');
            }
        };

        if (document.readyState === 'complete') {
            startFlight();
        } else {
            window.addEventListener('load', startFlight, { once: true });
        }
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
        }

        function triggerCrash(clientX, clientY) {
            if (hasCrashed) return;
            hasCrashed = true;
            lastCrashTime = Date.now();

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

            const isLocal = ['localhost', '127.0.0.1'].indexOf(window.location.hostname) !== -1 || window.location.protocol === 'file:';
            if (isLocal) {
                const cardEl = this || (e && e.currentTarget);
                const href = cardEl ? cardEl.getAttribute('href') : '';
                if (href) {
                    const m = href.match(/^https?:\/\/jiakuan\.link\/([a-z]{5})/i) || href.match(/^\/([a-z]{5})/i);
                    if (m && window.__SHORTLINK_MAP__ && window.__SHORTLINK_MAP__[m[1].toLowerCase()]) {
                        if (e) e.preventDefault();
                        window.open(window.__SHORTLINK_MAP__[m[1].toLowerCase()], '_blank', 'noopener,noreferrer');
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

    // 全局初始化入口（供 SPA 路由返回主页时唤醒交互）
    window.__initHomePageInteractive = function () {
        initGuideModal();
        initAndSortButtons();
        initCategoryFilter();
        initExpandButton();
        initCardQRCodes();
        initMobileAirplane();
        if (typeof Matter !== 'undefined') {
            initDesktopPhysics();
        } else {
            loadMatterJs();
        }
    };

    // 页面加载就绪后统一启动
    function bootstrap() {
        initThemeManager();
        window.__initHomePageInteractive();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
