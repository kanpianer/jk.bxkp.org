/**
 * js/shortlink-templates.js
 *
 * 短链静态跳板页 / 404 智能兜底页 / index.html 路由块的「唯一模板来源」。
 *
 * 为什么要单独抽出来：
 * 本项目的短链产物既会被 Node 构建脚本 (scripts/generate-links.js) 生成，
 * 也会被浏览器端在线 CMS (dtms/index.html) 直接合成并提交到 GitHub。
 * 两边若各写一份模板，就会长期漂移（历史上正因为如此，新增短链没有生成跳板页而 404）。
 * 因此这里提供一份纯 ES 模块，不依赖 DOM / Node API，两端共用，保证产物逐字节一致。
 */

/** 自定义短链使用的正式域名 */
export const SHORTLINK_BASE_URL = 'https://jiakuan.link';

/** index.html 内的路由块标记 */
export const ROUTER_START = '<!-- SHORTLINK_ROUTER_START -->';
export const ROUTER_END = '<!-- SHORTLINK_ROUTER_END -->';

/**
 * 转移字符，防止 HTML 注入
 */
export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 生成单个短链静态 HTML 跳板
 */
export function renderRedirectHtml(title, targetUrl, slug) {
  const cleanTitle = String(title || '').replace(/^[!！#＃]+\s*/, '');
  const safeTitle = escapeHtml(cleanTitle);
  const safeUrl = escapeHtml(targetUrl);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>正在前往 ${safeTitle}...</title>
    <meta http-equiv="refresh" content="0; url=${safeUrl}">
    <meta name="robots" content="noindex, nofollow">
    <link rel="canonical" href="${safeUrl}">
    <script>
        (function() {
            try {
                window.location.replace("${targetUrl.replace(/"/g, '\\"')}");
            } catch(e) {
                window.location.href = "${targetUrl.replace(/"/g, '\\"')}";
            }
        })();
    </script>
    <style>
        body {
            background-color: #0b0f19;
            color: #94a3b8;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 24px;
            box-sizing: border-box;
            text-align: center;
        }
        .container {
            max-width: 460px;
            background: rgba(30, 41, 59, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 32px 24px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(12px);
        }
        .spinner {
            width: 36px;
            height: 36px;
            border: 3px solid rgba(56, 189, 248, 0.2);
            border-top-color: #38bdf8;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .title {
            font-size: 1.15rem;
            color: #f1f5f9;
            margin-bottom: 10px;
            font-weight: 600;
        }
        .desc {
            font-size: 0.875rem;
            color: #64748b;
            line-height: 1.6;
        }
        .link {
            display: inline-block;
            margin-top: 14px;
            color: #38bdf8;
            text-decoration: underline;
            font-size: 0.875rem;
            word-break: break-all;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <div class="title">正在前往 ${safeTitle}...</div>
        <div class="desc">若浏览器未在数秒内自动跳转，请点击下方链接直接访问：</div>
        <a class="link" href="${safeUrl}">点击直接前往</a>
    </div>
</body>
</html>
`;
}

/**
 * 生成 404 智能兜底 HTML
 */
export function render404Html(slugMap) {
  const mapJson = JSON.stringify(buildTargetMap(slugMap));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>404 - 您访问的链接已失效</title>
    <meta name="robots" content="noindex, nofollow">
    <script>
        (function() {
            var map = ${mapJson};
            var path = window.location.pathname.replace(/^\\/+|\\/+$/g, '').toLowerCase();
            var slug = path.split('/').pop();
            if (map[slug]) {
                window.location.replace(map[slug]);
                return;
            }
        })();
    </script>
    <style>
        * {
            box-sizing: border-box;
        }
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            overscroll-behavior: none;
            background-color: #000000;
        }
        body {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            min-height: 100dvh;
            height: 100vh;
            height: 100dvh;
            padding: 0 20px 10vh 20px;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            text-align: center;
            user-select: none;
            -webkit-user-select: none;
        }
        .stars {
            position: fixed;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            overflow: hidden;
            z-index: 1;
        }
        .star {
            position: absolute;
            background-color: #ffffff;
            border-radius: 50%;
            opacity: 0.2;
            animation: twinkle ease-in-out infinite alternate;
        }
        @keyframes twinkle {
            0% {
                opacity: 0.15;
                transform: scale(0.7);
            }
            50% {
                opacity: 0.95;
                box-shadow: 0 0 3px rgba(255, 255, 255, 0.85);
                transform: scale(1.2);
            }
            100% {
                opacity: 0.25;
                transform: scale(0.8);
            }
        }
        .content {
            position: relative;
            z-index: 2;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }
        .num-404 {
            font-size: clamp(5.5rem, 16vw, 8rem);
            font-weight: 800;
            line-height: 1;
            margin: 0;
            color: #ffffff;
            letter-spacing: 2px;
        }
        .desc {
            font-size: clamp(1rem, 3.2vw, 1.15rem);
            color: #cbd5e1;
            margin: 8px 0 0 0;
            line-height: 1.4;
            font-weight: 400;
        }
        .category-btn {
            margin-top: 28px;
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: auto !important;
            max-width: none !important;
            min-width: 5rem;
            height: 2.5rem !important;
            min-height: 2.5rem !important;
            padding: 0 1.5rem !important;
            font-size: 1rem !important;
            font-weight: 700;
            font-family: inherit;
            color: #ffffff !important;
            background-color: transparent !important;
            background: transparent !important;
            border: 1px solid rgba(255, 255, 255, 0.6) !important;
            border-radius: 9999px !important;
            cursor: pointer;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08) !important;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2) !important;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            outline: none;
            text-decoration: none !important;
            white-space: nowrap;
            -webkit-tap-highlight-color: transparent;
            pointer-events: auto;
        }
        @media (hover: hover) and (pointer: fine) {
            .category-btn:hover {
                color: #ffffff !important;
                background-color: rgba(255, 255, 255, 0.12) !important;
                background: rgba(255, 255, 255, 0.12) !important;
                border-color: #ffffff !important;
                transform: scale(1.05);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
            }
        }
        .category-btn:active {
            transform: scale(0.97);
        }
        @media (max-width: 34.375rem) {
            .category-btn {
                min-width: 4.2rem;
                height: 2.25rem !important;
                min-height: 2.25rem !important;
                padding: 0 1.15rem !important;
                font-size: 0.9375rem !important;
            }
        }
    </style>
</head>
<body>
    <div class="stars" aria-hidden="true">
        <div class="star" style="top: 12%; left: 18%; width: 2px; height: 2px; animation-duration: 2.8s; animation-delay: 0.2s;"></div>
        <div class="star" style="top: 22%; left: 78%; width: 1.5px; height: 1.5px; animation-duration: 3.4s; animation-delay: 1.1s;"></div>
        <div class="star" style="top: 9%; left: 63%; width: 2px; height: 2px; animation-duration: 2.6s; animation-delay: 0.7s;"></div>
        <div class="star" style="top: 35%; left: 22%; width: 1px; height: 1px; animation-duration: 2.2s; animation-delay: 1.5s;"></div>
        <div class="star" style="top: 73%; left: 16%; width: 2px; height: 2px; animation-duration: 3.6s; animation-delay: 2.0s;"></div>
        <div class="star" style="top: 84%; left: 74%; width: 1.5px; height: 1.5px; animation-duration: 3.1s; animation-delay: 0.4s;"></div>
        <div class="star" style="top: 58%; left: 86%; width: 2px; height: 2px; animation-duration: 2.9s; animation-delay: 1.8s;"></div>
        <div class="star" style="top: 18%; left: 43%; width: 1.5px; height: 1.5px; animation-duration: 2.4s; animation-delay: 2.3s;"></div>
        <div class="star" style="top: 48%; left: 88%; width: 1px; height: 1px; animation-duration: 3.3s; animation-delay: 0.9s;"></div>
        <div class="star" style="top: 89%; left: 34%; width: 2px; height: 2px; animation-duration: 2.7s; animation-delay: 1.3s;"></div>
        <div class="star" style="top: 76%; left: 57%; width: 1.5px; height: 1.5px; animation-duration: 3.5s; animation-delay: 0.6s;"></div>
        <div class="star" style="top: 31%; left: 8%; width: 2px; height: 2px; animation-duration: 2.3s; animation-delay: 1.7s;"></div>
        <div class="star" style="top: 65%; left: 41%; width: 1px; height: 1px; animation-duration: 3.2s; animation-delay: 2.5s;"></div>
        <div class="star" style="top: 15%; left: 91%; width: 2px; height: 2px; animation-duration: 2.7s; animation-delay: 1.0s;"></div>
        <div class="star" style="top: 80%; left: 12%; width: 1.5px; height: 1.5px; animation-duration: 3.7s; animation-delay: 0.8s;"></div>
        <div class="star" style="top: 43%; left: 68%; width: 2px; height: 2px; animation-duration: 2.5s; animation-delay: 2.2s;"></div>
        <div class="star" style="top: 7%; left: 33%; width: 1.5px; height: 1.5px; animation-duration: 3.0s; animation-delay: 1.4s;"></div>
        <div class="star" style="top: 92%; left: 87%; width: 2px; height: 2px; animation-duration: 2.8s; animation-delay: 0.3s;"></div>
        <div class="star" style="top: 54%; left: 14%; width: 1px; height: 1px; animation-duration: 3.1s; animation-delay: 1.9s;"></div>
        <div class="star" style="top: 25%; left: 53%; width: 2px; height: 2px; animation-duration: 2.2s; animation-delay: 2.6s;"></div>
        <div class="star" style="top: 68%; left: 81%; width: 1.5px; height: 1.5px; animation-duration: 3.6s; animation-delay: 1.2s;"></div>
        <div class="star" style="top: 87%; left: 49%; width: 1px; height: 1px; animation-duration: 2.6s; animation-delay: 1.6s;"></div>
    </div>
    <div class="content">
        <h1 class="num-404">404</h1>
        <p class="desc">您访问的链接已失效</p>
        <a class="category-btn" href="/">返回家宽导航</a>
    </div>
</body>
</html>
`;
}

/**
 * 提取 slug -> 目标地址 的纯映射
 */
export function buildTargetMap(slugMap) {
  return Object.fromEntries(
    Object.entries(slugMap || {}).map(([slug, info]) => [slug, info.target])
  );
}

/**
 * 需要生成静态跳板页的短链（排除站内锚点自跳转与无效目标）
 */
export function collectFallbackEntries(linksMap, baseUrl = SHORTLINK_BASE_URL) {
  return Object.entries(linksMap || {}).filter(
    ([, item]) => item && item.target && !item.target.startsWith(baseUrl)
  );
}

/**
 * 生成注入 <head> 的短链路由块（Service Worker / SPA 回退到 index.html 时兜底跳转）
 */
export function renderShortlinkRouterBlock(slugMap) {
  const targetMapObj = buildTargetMap(slugMap);

  return `${ROUTER_START}
    <script>
        (function() {
            try {
                window.__SHORTLINK_MAP__ = ${JSON.stringify(targetMapObj)};
                var p = window.location.pathname.replace(/^\\/+|\\/+$/g, '').toLowerCase().split('/').pop();
                if (p && window.__SHORTLINK_MAP__[p]) {
                    window.location.replace(window.__SHORTLINK_MAP__[p]);
                }
            } catch(e) {}
        })();
    </script>
    ${ROUTER_END}`;
}

/**
 * 将短链路由块写入（或替换）index.html
 */
export function injectShortlinkRouter(html, slugMap) {
  const block = renderShortlinkRouterBlock(slugMap);
  if (html.includes(ROUTER_START)) {
    return html.replace(/<!-- SHORTLINK_ROUTER_START -->[\s\S]*?<!-- SHORTLINK_ROUTER_END -->/, block);
  }
  return html.replace('<head>', `<head>\n    ${block}`);
}
