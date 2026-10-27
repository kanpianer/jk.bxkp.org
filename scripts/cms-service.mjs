/**
 * scripts/cms-service.mjs
 *
 * 家宽导航 (jiakuan.link) 内容管理系统 (CMS) 核心数据服务
 * 功能：
 * 1. 深度精准解析 index.html 中的卡片、指南弹窗、SEO FAQ 知识库；
 * 2. 深度精准解析 links-map.json、guides/*.html 与 images/icons/；
 * 3. 序列化更新并回写 index.html 与 links-map.json，保证排版格式 100% 统一；
 * 4. 自动快照备份机制（.cms-backups/）与一键版本回滚；
 * 5. 自动触发 scripts/generate-links.js 重新生成短链跳板与 Cloudflare _redirects；
 * 6. 可选自动升级 sw.js 缓存版本号（如 v1.1.12 -> v1.1.13）；
 * 7. 并发链接健康度体检器（检测 404/500/超时链接）；
 * 8. 图标上传与管理；
 * 9. Git 自动 Commit & Push 联动。
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..');
export const INDEX_HTML_FILE = path.resolve(ROOT_DIR, 'index.html');
export const MAP_FILE = path.resolve(ROOT_DIR, 'links-map.json');
export const ICONS_DIR = path.resolve(ROOT_DIR, 'images/icons');
export const GUIDES_DIR = path.resolve(ROOT_DIR, 'guides');
export const SW_FILE = path.resolve(ROOT_DIR, 'sw.js');
export const BACKUP_DIR = path.resolve(ROOT_DIR, '.cms-backups');

/**
 * 确保目录存在
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 创建快照备份
 */
export function createBackup(note = 'auto') {
  ensureDir(BACKUP_DIR);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const targetSubDir = path.resolve(BACKUP_DIR, `backup_${timestamp}_${note}`);
  ensureDir(targetSubDir);

  if (fs.existsSync(INDEX_HTML_FILE)) {
    fs.copyFileSync(INDEX_HTML_FILE, path.resolve(targetSubDir, 'index.html'));
  }
  if (fs.existsSync(MAP_FILE)) {
    fs.copyFileSync(MAP_FILE, path.resolve(targetSubDir, 'links-map.json'));
  }
  if (fs.existsSync(SW_FILE)) {
    fs.copyFileSync(SW_FILE, path.resolve(targetSubDir, 'sw.js'));
  }

  const meta = {
    timestamp,
    note,
    createdAt: now.toISOString()
  };
  fs.writeFileSync(path.resolve(targetSubDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

/**
 * 列出所有备份
 */
export function listBackups() {
  ensureDir(BACKUP_DIR);
  const entries = fs.readdirSync(BACKUP_DIR);
  const backups = [];

  for (const entry of entries) {
    const fullPath = path.resolve(BACKUP_DIR, entry);
    if (fs.statSync(fullPath).isDirectory() && entry.startsWith('backup_')) {
      const metaFile = path.resolve(fullPath, 'meta.json');
      let meta = { id: entry };
      if (fs.existsSync(metaFile)) {
        try {
          meta = { ...meta, ...JSON.parse(fs.readFileSync(metaFile, 'utf8')) };
        } catch (e) {}
      }
      backups.push({
        id: entry,
        ...meta
      });
    }
  }

  return backups.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

/**
 * 恢复指定备份
 */
export function restoreBackup(backupId) {
  const targetSubDir = path.resolve(BACKUP_DIR, backupId);
  if (!fs.existsSync(targetSubDir)) {
    throw new Error(`备份 ${backupId} 不存在`);
  }

  // 先为当前现场留一份安全兜底备份
  createBackup('before_restore');

  const idxFile = path.resolve(targetSubDir, 'index.html');
  const mapFile = path.resolve(targetSubDir, 'links-map.json');
  const swFile = path.resolve(targetSubDir, 'sw.js');

  if (fs.existsSync(idxFile)) {
    fs.copyFileSync(idxFile, INDEX_HTML_FILE);
  }
  if (fs.existsSync(mapFile)) {
    fs.copyFileSync(mapFile, MAP_FILE);
  }
  if (fs.existsSync(swFile)) {
    fs.copyFileSync(swFile, SW_FILE);
  }

  return { success: true, restored: backupId };
}

/**
 * 获取可用图标列表
 */
export function getAvailableIcons() {
  ensureDir(ICONS_DIR);
  const files = fs.readdirSync(ICONS_DIR);
  return files
    .filter((f) => /\.(png|svg|ico|webp|jpg|jpeg)$/i.test(f))
    .sort()
    .map((filename) => {
      const fullPath = path.resolve(ICONS_DIR, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        path: `images/icons/${filename}`,
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      };
    });
}

/**
 * 获取 Service Worker 版本
 */
export function getSwVersion() {
  if (!fs.existsSync(SW_FILE)) return 'v1.0.0';
  const content = fs.readFileSync(SW_FILE, 'utf8');
  const m = content.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : 'v1.0.0';
}

/**
 * 递增 Service Worker 版本号 (例如 v1.1.12 -> v1.1.13)
 */
export function bumpSwVersion() {
  if (!fs.existsSync(SW_FILE)) return 'v1.0.0';
  let content = fs.readFileSync(SW_FILE, 'utf8');
  const m = content.match(/CACHE_VERSION\s*=\s*['"]v(\d+)\.(\d+)\.(\d+)['"]/);
  if (m) {
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    const patch = parseInt(m[3], 10) + 1;
    const newVersion = `v${major}.${minor}.${patch}`;
    content = content.replace(/CACHE_VERSION\s*=\s*['"][^'"]+['"]/, `CACHE_VERSION = '${newVersion}'`);
    fs.writeFileSync(SW_FILE, content, 'utf8');
    return newVersion;
  }
  return getSwVersion();
}

/**
 * 解析所有卡片
 */
export function parseCardsFromHtml(html, linksMap = {}) {
  const cardRegex = /<!--\s*([^\n\r]+?)\s*-->\s*(<a\b[^>]*class=["'][^"']*button-xzwl[^\"']*["'][^>]*>[\s\S]*?<\/a>)/gi;
  let match;
  const cards = [];

  while ((match = cardRegex.exec(html)) !== null) {
    const commentTitle = match[1];
    const cardHtml = match[2];

    const slugMatch = cardHtml.match(/data-slug=["']([^"']+)["']/i);
    const slug = slugMatch ? slugMatch[1] : '';

    const catMatch = cardHtml.match(/data-category=["']([^"']+)["']/i);
    const category = catMatch ? catMatch[1] : 'airport';

    const iconMatch = cardHtml.match(/<img[^>]*class=["'][^"']*icon[^"']*["'][^>]*src=["']([^"']+)["']/i);
    const icon = iconMatch ? iconMatch[1] : '';

    const titleMatch = cardHtml.match(/<h3[^>]*class=["'][^"']*card-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i);
    const rawTitle = titleMatch ? titleMatch[1].trim() : commentTitle;
    const isHighlight = rawTitle.startsWith('#') || rawTitle.startsWith('＃');
    const isHidden = rawTitle.startsWith('!') || rawTitle.startsWith('！') || cardHtml.includes('card-hidden');
    const cleanTitle = rawTitle.replace(/^[!！#＃\s]+/, '').trim();

    // 解析 card-header 中的标签
    const headerMatch = cardHtml.match(/<div class=["']card-header["']>([\s\S]*?)<\/div>/i);
    let headerTags = [];
    if (headerMatch) {
      const tagMatches = [...headerMatch[1].matchAll(/<span class=["']card-tag\s*([^"']*)["']>([\s\S]*?)<\/span>/gi)];
      headerTags = tagMatches.map((m) => ({ cls: m[1].trim(), text: m[2].trim() }));
    }

    // 解析 card-meta 中的文本与标签
    const metaMatch = cardHtml.match(/<div class=["']card-meta["']>([\s\S]*?)<\/div>/i);
    let metaText = '';
    let metaTag = null;
    if (metaMatch) {
      const metaTagMatch = metaMatch[1].match(/<span class=["']card-tag\s*([^"']*)["']>([\s\S]*?)<\/span>/i);
      if (metaTagMatch) {
        metaTag = { cls: metaTagMatch[1].trim(), text: metaTagMatch[2].trim() };
        metaText = metaMatch[1].replace(metaTagMatch[0], '').trim();
      } else {
        metaText = metaMatch[1].trim();
      }
    }

    // 解析 card-desc 中的简单描述
    const descMatch = cardHtml.match(/<div class=["']card-desc["']>([\s\S]*?)<\/div>/i);
    const desc = descMatch ? descMatch[1].trim() : '';

    const target = linksMap[slug]?.target || '';

    cards.push({
      slug,
      commentTitle,
      rawTitle,
      cleanTitle,
      isHighlight,
      isHidden,
      category,
      icon,
      headerTags,
      metaText,
      metaTag,
      desc,
      target
    });
  }

  return cards;
}

/**
 * 解析指南弹窗中的条目（向后兼容单列表）
 */
export function parseGuideModalItems(html) {
  const categoryGuides = parseCategoryGuides(html);
  if (categoryGuides && categoryGuides.airport && Array.isArray(categoryGuides.airport.items)) {
    return categoryGuides.airport.items;
  }
  const modalBodyRegex = /<div class=["']guide-modal-body["']>([\s\S]*?)<\/div>\s*<\/div>\s*<\/dialog>/i;
  const match = html.match(modalBodyRegex);
  if (!match) return [];

  const listItems = [...match[1].matchAll(/<li class=["']guide-item["']>([\s\S]*?)<\/li>/gi)];
  return listItems.map((m, idx) => {
    const textMatch = m[1].match(/<div class=["']guide-item-text["']>([\s\S]*?)<\/div>/i);
    return {
      index: idx + 1,
      content: textMatch ? textMatch[1].trim() : ''
    };
  });
}

/**
 * 解析按分类划分的指南弹窗数据 (老站 / 机场 / VPS)
 */
export function parseCategoryGuides(html) {
  const defaultGuides = {
    noble: {
      title: '老站指南',
      items: [
        { index: 1, content: '这里收集的都是开业年限较久，口碑较好的机场，当然，也意味着价格普遍更贵。这里面的机场相对更省心。' },
        { index: 2, content: '谨忌：机场跑路，投诉无门，优先月付。' }
      ]
    },
    airport: {
      title: '家宽指南',
      items: [
        { index: 1, content: '这里收集的都是包含家宽节点的机场，卡片上不同颜色的标签代表机场提供的不同服务和节点的不同属性。' },
        { index: 2, content: '如果目前手头不宽裕，<a href="https://fan.jiakuan.link/" target="_blank" rel="noopener">不想翻墙</a> 里收集了十几款免费的翻墙工具，也可以作为备用梯子。' },
        { index: 3, content: '家宽节点并不一定就比机房节点“干净”，做敏感业务前，最好先检测IP质量，或用小号测试。<br><span class="guide-sub-link">IP质量检测网站：<a href="https://ipsuper.com/" target="_blank" rel="noopener">IPSuper</a>、<a href="https://ip.cx" target="_blank" rel="noopener">IP.cx</a>、<a href="https://ipok.io/" target="_blank" rel="noopener">IPOK</a></span>' }
      ]
    },
    vps: {
      title: 'VPS指南',
      items: [
        { index: 1, content: '这里收集的都是VPS服务器，包括NAT：也就是多人共享的VPS，价格会便宜很多。' },
        { index: 2, content: '小白购买VPS后可到开源搭建工具 <a href="https://1click.qstz.ccwu.cc/" target="_blank" rel="noopener">一贱建节点</a> 根据提示搭建节点，不需要任何技术，简单地复制粘贴即可完成搭建。强烈建议自行搜索教程搭建。' }
      ]
    }
  };

  const bodyRegex = /<div class=["']guide-modal-body["']([^>]*)>([\s\S]*?<\/ol>\s*)<\/div>/gi;
  const matches = [...html.matchAll(bodyRegex)];

  if (!matches || matches.length === 0) {
    const singleRegex = /<div class=["']guide-modal-body["']>([\s\S]*?)<\/div>\s*<\/div>\s*<\/dialog>/i;
    const singleMatch = html.match(singleRegex);
    if (singleMatch) {
      const listItems = [...singleMatch[1].matchAll(/<li class=["']guide-item["']>([\s\S]*?)<\/li>/gi)];
      const items = listItems.map((m, idx) => {
        const textMatch = m[1].match(/<div class=["']guide-item-text["']>([\s\S]*?)<\/div>/i);
        return { index: idx + 1, content: textMatch ? textMatch[1].trim() : '' };
      });
      return {
        ...defaultGuides,
        airport: { title: '家宽指南', items }
      };
    }
    return defaultGuides;
  }

  const guides = {};
  for (const match of matches) {
    const attrs = match[1];
    const bodyContent = match[2];

    const catMatch = attrs.match(/data-category=["']([^"']+)["']/i);
    const titleMatch = attrs.match(/data-title=["']([^"']+)["']/i);

    const category = catMatch ? catMatch[1] : 'airport';
    let fallbackTitle = '家宽指南';
    if (category === 'noble') fallbackTitle = '老站指南';
    else if (category === 'vps') fallbackTitle = 'VPS指南';
    const title = titleMatch ? titleMatch[1] : fallbackTitle;

    const listItems = [...bodyContent.matchAll(/<li class=["']guide-item["']>([\s\S]*?)<\/li>/gi)];
    const items = listItems.map((m, idx) => {
      const textMatch = m[1].match(/<div class=["']guide-item-text["']>([\s\S]*?)<\/div>/i);
      return {
        index: idx + 1,
        content: textMatch ? textMatch[1].trim() : ''
      };
    });

    guides[category] = {
      title,
      items
    };
  }

  for (const cat of ['noble', 'airport', 'vps']) {
    if (!guides[cat]) {
      guides[cat] = defaultGuides[cat];
    }
  }

  return guides;
}

/**
 * 解析 SEO FAQ 条目
 */
export function parseFaqItems(html) {
  const faqAccordionRegex = /<div class=["']faq-accordion["']>([\s\S]*?)<\/div>\s*<\/article>/i;
  const match = html.match(faqAccordionRegex);
  if (!match) return [];

  const detailsMatches = [...match[1].matchAll(/<details class=["']faq-item["']>([\s\S]*?)<\/details>/gi)];
  return detailsMatches.map((d) => {
    const qMatch = d[1].match(/<summary class=["']faq-question["']>([\s\S]*?)<\/summary>/i);
    const aMatch = d[1].match(/<div class=["']faq-answer["']>([\s\S]*?)<\/div>/i);
    return {
      question: qMatch ? qMatch[1].trim() : '',
      answer: aMatch ? aMatch[1].trim() : ''
    };
  });
}

/**
 * 解析深度指南文章列表
 */
export function parseGuideArticles() {
  ensureDir(GUIDES_DIR);
  const files = fs.readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.html'));
  const articles = [];

  for (const filename of files) {
    const filePath = path.resolve(GUIDES_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');

    const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
    const descMatch = content.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    const h1Match = content.match(/<h1 class=["']guide-title["']>([\s\S]*?)<\/h1>/i);
    const articleMatch = content.match(/<article class=["']guide-article["']>([\s\S]*?)<\/article>/i);

    articles.push({
      filename,
      slug: filename.replace(/\.html$/, ''),
      path: `guides/${filename}`,
      title: titleMatch ? titleMatch[1].trim() : filename,
      headline: h1Match ? h1Match[1].trim() : '',
      description: descMatch ? descMatch[1].trim() : '',
      contentHtml: articleMatch ? articleMatch[1].trim() : '',
      rawHtml: content
    });
  }

  return articles;
}

/**
 * 单张卡片渲染为标准 HTML
 */
export function renderCardHtml(card) {
  const isAirport = card.category === 'airport';
  const displayTitle = (card.isHighlight ? '#' : (card.isHidden ? '!' : '')) + card.cleanTitle;
  const cardHiddenClass = card.isHidden ? ' card-hidden' : '';
  const filterClass = isAirport ? '' : ' category-filtered-out';
  const displayStyle = isAirport ? '' : ' style="display: none;"';

  let headerTagsHtml = '';
  if (card.headerTags && card.headerTags.length > 0) {
    headerTagsHtml = '\n                            ' + card.headerTags
      .filter((t) => t && t.text)
      .map((t) => `<span class="card-tag ${t.cls || ''}">${t.text}</span>`)
      .join('\n                            ');
  }

  let metaTagHtml = '';
  if (card.metaTag && card.metaTag.text) {
    metaTagHtml = ` <span class="card-tag ${card.metaTag.cls || ''}">${card.metaTag.text}</span>`;
  }

  const descHtml = card.desc ? `\n                        <div class="card-desc">${card.desc}</div>` : '';

  const hasDescClass = card.desc ? ' has-desc' : '';

  return `                <!-- ${card.cleanTitle} -->
                <a data-slug="${card.slug}" class="button button-xzwl${cardHiddenClass}${filterClass}${hasDescClass}" href="https://jiakuan.link/${card.slug}" target="_blank"
                    rel="sponsored noopener" role="button" data-category="${card.category}"${displayStyle}>
                    <img class="icon" aria-hidden="true" src="${card.icon}" alt="${card.cleanTitle} Logo" width="30" height="30" loading="lazy" decoding="async">
                    <div class="card-info">
                        <div class="card-header">
                            <h3 class="card-title">${displayTitle}</h3>${headerTagsHtml}
                        </div>
                        <div class="card-meta">${card.metaText || ''}${metaTagHtml}</div>
                    </div>${descHtml}
                </a>`;
}

/**
 * 生成完整的 button-stack 区域 HTML
 */
export function renderButtonStackHtml(cards) {
  // 分组并确保置顶卡片排在前面
  const sortFn = (a, b) => (b.isHighlight ? 1 : 0) - (a.isHighlight ? 1 : 0);
  const nobleCards = cards.filter((c) => c.category === 'noble').sort(sortFn);
  const airportCards = cards.filter((c) => c.category === 'airport').sort(sortFn);
  const vpsCards = cards.filter((c) => c.category === 'vps').sort(sortFn);
  const otherCards = cards.filter((c) => !['noble', 'airport', 'vps'].includes(c.category)).sort(sortFn);

  const sections = [];

  if (nobleCards.length > 0) {
    sections.push('                <!-- ========== 老站 ========== -->\n' + nobleCards.map(renderCardHtml).join('\n\n'));
  }
  if (airportCards.length > 0) {
    sections.push('                <!-- ========== 机场 ========== -->\n' + airportCards.map(renderCardHtml).join('\n\n'));
  }
  if (vpsCards.length > 0) {
    sections.push('                <!-- ========== VPS ========== -->\n' + vpsCards.map(renderCardHtml).join('\n\n'));
  }
  if (otherCards.length > 0) {
    sections.push('                <!-- ========== 其他 ========== -->\n' + otherCards.map(renderCardHtml).join('\n\n'));
  }

  return `            <div class="button-stack" role="navigation">\n\n${sections.join('\n\n\n')}\n\n            </div>`;
}

/**
 * 将多分类指南渲染为标准 HTML
 */
export function renderCategoryGuidesHtml(categoryGuides) {
  const categories = Object.keys(categoryGuides);
  const order = ['noble', 'airport', 'vps'];
  categories.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const sections = [];
  for (const cat of categories) {
    const guide = categoryGuides[cat];
    const isAirport = (cat === 'airport');
    const displayStyle = isAirport ? '' : ' style="display: none;"';
    const title = guide.title || (cat === 'noble' ? '老站指南' : (cat === 'vps' ? 'VPS指南' : '家宽指南'));
    const items = guide.items || [];

    const itemsHtml = items.map((it, idx) => `                    <li class="guide-item">
                        <span class="guide-item-badge">${idx + 1}</span>
                        <div class="guide-item-text">
                            ${it.content}
                        </div>
                    </li>`).join('\n');

    sections.push(`            <!-- 指南内容：${title} -->
            <div class="guide-modal-body" data-category="${cat}" data-title="${title}"${displayStyle}>
                <ol class="guide-list">
${itemsHtml}
                </ol>
            </div>`);
  }

  return sections.join('\n');
}

/**
 * 生成指南弹窗 HTML 块
 */
export function renderGuideModalBodyHtml(items) {
  const itemsHtml = items.map((it, idx) => `                    <li class="guide-item">
                        <span class="guide-item-badge">${idx + 1}</span>
                        <div class="guide-item-text">
                            ${it.content}
                        </div>
                    </li>`).join('\n');

  return `            <div class="guide-modal-body">
                <ol class="guide-list">
${itemsHtml}
                </ol>
            </div>`;
}

/**
 * 生成 FAQ Accordion HTML 块
 */
export function renderFaqAccordionHtml(faqs) {
  const faqsHtml = faqs.map((f) => `                        <details class="faq-item">
                            <summary class="faq-question">${f.question}</summary>
                            <div class="faq-answer">
                                ${f.answer}
                            </div>
                        </details>`).join('\n');

  return `                    <div class="faq-accordion">\n${faqsHtml}\n                    </div>`;
}

/**
 * 读取全量 CMS 数据
 */
export function readAllData() {
  if (!fs.existsSync(INDEX_HTML_FILE)) {
    throw new Error('未找到 index.html');
  }

  const indexHtml = fs.readFileSync(INDEX_HTML_FILE, 'utf8');
  let linksMap = {};
  if (fs.existsSync(MAP_FILE)) {
    try {
      linksMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
    } catch (e) {}
  }

  const cards = parseCardsFromHtml(indexHtml, linksMap);
  const categoryGuides = parseCategoryGuides(indexHtml);
  const modalItems = categoryGuides.airport ? categoryGuides.airport.items : parseGuideModalItems(indexHtml);
  const faqItems = parseFaqItems(indexHtml);
  const guideArticles = parseGuideArticles();
  const availableIcons = getAvailableIcons();
  const swVersion = getSwVersion();

  return {
    cards,
    categoryGuides,
    modalItems,
    faqItems,
    guideArticles,
    availableIcons,
    swVersion,
    linksMap
  };
}

/**
 * 执行 generate-links 脚本更新短链跳板
 */
export function runGenerateLinks() {
  return new Promise((resolve, reject) => {
    exec('node scripts/generate-links.js', { cwd: ROOT_DIR }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`构建脚本执行失败: ${stderr || err.message}`));
      }
      resolve(stdout);
    });
  });
}

/**
 * 保存全量 CMS 数据
 */
export async function saveAllData({ cards, categoryGuides, modalItems, faqItems, guideArticles, bumpSw = true }) {
  // 1. 创建备份
  createBackup('before_cms_save');

  let html = fs.readFileSync(INDEX_HTML_FILE, 'utf8');

  // 2. 替换 button-stack 区域
  if (Array.isArray(cards)) {
    const stackStart = '<div class="button-stack" role="navigation">';
    const stackEnd = '<!-- 展开隐藏卡片按钮';
    const startIdx = html.indexOf(stackStart);
    const endIdx = html.indexOf(stackEnd, startIdx);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = html.substring(0, startIdx);
      const after = html.substring(endIdx);
      const newStackHtml = renderButtonStackHtml(cards);
      html = before + newStackHtml.trim() + '\n\n            ' + after;
    }
  }

  // 3. 替换指南弹窗区域
  if (categoryGuides && typeof categoryGuides === 'object' && Object.keys(categoryGuides).length > 0) {
    const modalBodiesRegionRegex = /(<button id=["']guide-modal-close["'][\s\S]*?<\/button>\s*<\/div>)([\s\S]*?)(<\/div>\s*<\/dialog>)/i;
    const match = html.match(modalBodiesRegionRegex);
    if (match) {
      const newBodiesHtml = renderCategoryGuidesHtml(categoryGuides);
      html = html.replace(modalBodiesRegionRegex, `$1\n${newBodiesHtml}\n        $3`);
    }

    if (categoryGuides.airport && categoryGuides.airport.title) {
      const airportTitle = categoryGuides.airport.title;
      html = html.replace(/<span id=["']guide-toggle-text["']>[\s\S]*?<\/span>/i, `<span id="guide-toggle-text">${airportTitle}</span>`);
      html = html.replace(/<button id=["']guide-toggle["'][^>]*>/i, (m) => {
        return m.replace(/aria-label=["'][^"']*["']/i, `aria-label="${airportTitle}"`).replace(/title=["'][^"']*["']/i, `title="${airportTitle}"`);
      });
      html = html.replace(/<h2 id=["']guide-modal-title["'][^>]*>[\s\S]*?<\/h2>/i, `<h2 id="guide-modal-title" class="guide-modal-title">${airportTitle}</h2>`);
    }
  } else if (Array.isArray(modalItems)) {
    const modalBodyRegex = /<div class=["']guide-modal-body["']>([\s\S]*?)<\/div>\s*<\/div>\s*<\/dialog>/i;
    const match = html.match(modalBodyRegex);
    if (match) {
      const newModalBodyHtml = renderGuideModalBodyHtml(modalItems);
      html = html.replace(modalBodyRegex, `${newModalBodyHtml}\n        </div>\n    </dialog>`);
    }
  }

  // 4. 替换 FAQ 区域与 Schema.org JSON-LD
  if (Array.isArray(faqItems)) {
    const faqAccordionRegex = /<div class=["']faq-accordion["']>([\s\S]*?)<\/div>\s*<\/article>/i;
    const match = html.match(faqAccordionRegex);
    if (match) {
      const newFaqHtml = renderFaqAccordionHtml(faqItems);
      html = html.replace(faqAccordionRegex, `${newFaqHtml}\n                </article>`);
    }

    // 同步更新 Schema.org FAQPage
    const faqSchemaRegex = /"@type":\s*"FAQPage"[\s\S]*?"mainEntity":\s*\[[\s\S]*?\]\s*\}/i;
    const faqSchemaMatch = html.match(faqSchemaRegex);
    if (faqSchemaMatch) {
      const mainEntities = faqItems.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: f.answer.replace(/<[^>]+>/g, '').trim()
        }
      }));
      const newSchemaSnippet = `"@type": "FAQPage",\n          "@id": "https://jiakuan.link/#faq",\n          "mainEntity": ${JSON.stringify(mainEntities, null, 12).replace(/\n\s*}/g, '\n          }')}`;
      html = html.replace(faqSchemaRegex, newSchemaSnippet);
    }
  }

  // 写入 index.html
  fs.writeFileSync(INDEX_HTML_FILE, html, 'utf8');

  // 5. 更新 links-map.json
  if (Array.isArray(cards)) {
    let linksMap = {};
    if (fs.existsSync(MAP_FILE)) {
      try {
        linksMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
      } catch (e) {}
    }

    const today = new Date().toISOString().split('T')[0];
    for (const card of cards) {
      if (card.slug && card.target) {
        const displayTitle = (card.isHighlight ? '#' : (card.isHidden ? '!' : '')) + card.cleanTitle;
        linksMap[card.slug] = {
          title: displayTitle,
          target: card.target,
          category: card.category,
          updatedAt: today
        };
      }
    }

    const sortedMap = Object.keys(linksMap)
      .sort()
      .reduce((acc, key) => {
        acc[key] = linksMap[key];
        return acc;
      }, {});

    fs.writeFileSync(MAP_FILE, JSON.stringify(sortedMap, null, 2) + '\n', 'utf8');
  }

  // 6. 如果有被修改的深度文章，一并保存
  if (Array.isArray(guideArticles)) {
    for (const art of guideArticles) {
      if (art && art.filename && (art._modified || art.isModified)) {
        try {
          saveGuideArticle(art);
        } catch (e) {
          console.warn(`[CMS Warning] 自动保存文章 ${art.filename} 失败:`, e.message);
        }
      }
    }
  }

  // 7. 是否递增 Service Worker 缓存版本
  let newSwVersion = getSwVersion();
  if (bumpSw) {
    newSwVersion = bumpSwVersion();
  }

  // 8. 运行 generate-links 脚本同步短链跳板
  let buildOutput = '';
  try {
    buildOutput = await runGenerateLinks();
  } catch (err) {
    console.warn('[CMS Warning] 自动构建跳板警告:', err.message);
  }

  return {
    success: true,
    swVersion: newSwVersion,
    buildOutput
  };
}

/**
 * 标准深度指南文章 HTML 模板生成器
 */
export function generateGuideArticleHtml({ slug, filename, headline, description, category = '网络基础 / 风险排坑', contentHtml = '' }) {
  const cleanSlug = slug || filename.replace(/\.html$/, '');
  const cleanFilename = filename.endsWith('.html') ? filename : `${filename}.html`;
  const now = new Date();
  const yearMonth = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  const defaultBody = contentHtml || `            <h2>一、 背景与概述</h2>
            <p>这里填写文章第一章节的详细分析与背景介绍...</p>

            <div class="callout callout-warning">
                <strong>核心风险提示：</strong><br>
                在这里提醒用户需要重点关注的避坑指南与核心要点。
            </div>

            <h2>二、 技术深度解析</h2>
            <p>深入分析业务逻辑、IP纯净度或网络架构细节...</p>

            <h2>三、 选购与配置指南</h2>
            <p>结合实际场景给出具体建议...</p>`;

  return `<!DOCTYPE html>
<html class="theme-auto" lang="zh-CN">
<head>
    <meta charset="utf-8">
    <script>
        (function() {
            try {
                var urlParams = new URLSearchParams(window.location.search);
                var urlTheme = urlParams.get('theme');
                if (urlTheme === 'light' || urlTheme === 'dark') {
                    localStorage.setItem('theme', urlTheme);
                }
                var stored = localStorage.getItem('theme');
                var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (stored === 'dark' || (!stored && prefersDark)) {
                    document.documentElement.classList.add('theme-dark');
                    document.documentElement.classList.remove('theme-light', 'theme-auto');
                } else if (stored === 'light' || (!stored && !prefersDark)) {
                    document.documentElement.classList.add('theme-light');
                    document.documentElement.classList.remove('theme-dark', 'theme-auto');
                }
            } catch (e) {}
        })();
    </script>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${headline} | 家宽导航</title>
    <meta name="description" content="${description || ''}">
    <link rel="canonical" href="https://jiakuan.link/guides/${cleanFilename}">
    <link rel="icon" type="image/x-icon" href="../images/avatar.png">

    <!-- Preload Critical Sky Texture -->
    <link rel="preload" as="image" href="../images/anime_sky_bg.jpg">

    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@300;400;700&display=swap">
    <link href="https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@300;400;700&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
    <noscript><link href="https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@300;400;700&display=swap" rel="stylesheet"></noscript>

    <!-- Styles -->
    <link rel="stylesheet" href="../css/reset.css">
    <link rel="stylesheet" href="../css/style.css">
    <link rel="stylesheet" href="../css/guide.css">

    <!-- Schema.org JSON-LD -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Article",
          "headline": ${JSON.stringify(headline || cleanSlug)},
          "description": ${JSON.stringify(description || '')},
          "mainEntityOfPage": "https://jiakuan.link/guides/${cleanFilename}",
          "author": {
            "@type": "Organization",
            "name": "家宽导航",
            "url": "https://jiakuan.link/"
          },
          "publisher": {
            "@type": "Organization",
            "name": "家宽导航",
            "logo": {
              "@type": "ImageObject",
              "url": "https://jiakuan.link/images/avatar.png"
            }
          }
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "position": 1,
              "name": "首页",
              "item": "https://jiakuan.link/"
            },
            {
              "@type": "ListItem",
              "position": 2,
              "name": "深度指南",
              "item": "https://jiakuan.link/#seo-knowledge"
            },
            {
              "@type": "ListItem",
              "position": 3,
              "name": ${JSON.stringify(headline || cleanSlug)},
              "item": "https://jiakuan.link/guides/${cleanFilename}"
            }
          ]
        }
      ]
    }
    </script>
</head>
<body class="guide-body">
    <!-- 极简悬浮返回按钮（全局常驻层，无背景、极简纯白图标） -->
    <a href="/" id="floating-back-btn" class="floating-back-btn" title="返回" aria-label="返回">
        <svg viewBox="0 0 88 88" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
            <path d="M 16 44 L 43 23.5 L 43 34 C 62 34 73 46 76.5 64 C 68 55.5 56 52 43 53 L 43 64.5 Z"></path>
        </svg>
    </a>

    <!-- 极简左上角指南按钮（主页常驻，文章页隐藏） -->
    <button id="guide-toggle" class="guide-toggle-btn" type="button" aria-label="指南" title="指南" style="display: none;">
        <svg class="guide-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
        </svg>
        <span>指南</span>
    </button>

    <!-- 极简右上角小太阳/主题切换按钮（全局常驻层） -->
    <button id="theme-toggle" class="theme-toggle-btn" type="button" aria-label="切换主题" title="切换主题">
        <span class="theme-stage">
            <svg class="theme-icon sun-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4.5"></circle>
                <line x1="12" y1="2" x2="12" y2="4.5"></line>
                <line x1="12" y1="19.5" x2="12" y2="22"></line>
                <line x1="2" y1="12" x2="4.5" y2="12"></line>
                <line x1="19.5" y1="12" x2="22" y2="12"></line>
                <line x1="4.93" y1="4.93" x2="6.7" y2="6.7"></line>
                <line x1="17.3" y1="17.3" x2="19.07" y2="19.07"></line>
                <line x1="4.93" y1="19.07" x2="6.7" y2="17.3"></line>
                <line x1="17.3" y1="6.7" x2="19.07" y2="4.93"></line>
            </svg>
            <svg class="theme-icon moon-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
        </span>
    </button>

    <!-- 极简右下角返回顶部按钮（全局常驻层，无背景、透明、纯白极简箭头图标） -->
    <button id="back-to-top" class="back-to-top-btn" type="button" aria-label="返回顶部" title="返回顶部">
        <svg class="back-to-top-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7"></path>
        </svg>
    </button>

    <!-- 深度指南文章视图容器 -->
    <div id="guide-view" class="guide-view">
        <div class="guide-wrapper">
            <article class="guide-article">
                <h1 class="guide-title">${headline}</h1>
                <div class="guide-meta">
                    <span>📅 发布时间：${yearMonth}</span>
                    <span>🏷️ 分类：${category}</span>
                    <span>⏱️ 阅读时长：约 5 分钟</span>
                </div>

${defaultBody}

                <div class="guide-footer-cta">
                    <a href="/" class="guide-footer-btn" title="返回" aria-label="返回">
                        <svg viewBox="0 0 88 88" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
                            <path d="M 16 44 L 43 23.5 L 43 34 C 62 34 73 46 76.5 64 C 68 55.5 56 52 43 53 L 43 64.5 Z"></path>
                        </svg>
                        <span>返回</span>
                    </a>
                </div>
            </article>
        </div>
    </div>
    <!-- guide-view END -->

    <!-- 首页主视图容器（直访文章返回首页时动态挂载） -->
    <div id="homepage-view" class="homepage-view" style="display: none;"></div>

    <!-- 2.5D Living Anime Sky Background -->
    <div id="sky-canvas-container" class="sky-container">
        <canvas id="sky-canvas"></canvas>
    </div>

    <!-- 核心脚本体系 (全部使用 defer 确保非阻塞按序加载与解析) -->
    <script src="../js/three.min.js" defer></script>
    <script src="../js/sky.js" defer></script>
    <script src="../js/page-router.js" defer></script>
    <script src="../js/main.js" defer></script>
</body>
</html>\n`;
}

/**
 * 保存单个深度指南文章（支持修改与自动新建）
 */
export function saveGuideArticle({ filename, headline, description, contentHtml, category, addToIndex, homeDesc }) {
  ensureDir(GUIDES_DIR);
  let cleanFilename = path.basename(filename).trim();
  if (!cleanFilename.endsWith('.html')) {
    cleanFilename += '.html';
  }
  const targetFile = path.resolve(GUIDES_DIR, cleanFilename);

  let html;
  if (!fs.existsSync(targetFile)) {
    // 新建文章
    html = generateGuideArticleHtml({
      slug: cleanFilename.replace(/\.html$/, ''),
      filename: cleanFilename,
      headline: headline || cleanFilename.replace(/\.html$/, ''),
      description: description || '',
      category: category || '网络基础 / 风险排坑',
      contentHtml
    });
  } else {
    html = fs.readFileSync(targetFile, 'utf8');
    if (description !== undefined) {
      html = html.replace(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i, `<meta name="description" content="${description}">`);
    }
    if (contentHtml !== undefined) {
      html = html.replace(/<article class=["']guide-article["']>([\s\S]*?)<\/article>/i, `<article class="guide-article">\n${contentHtml}\n            </article>`);
    }
    if (headline !== undefined) {
      html = html.replace(/<h1 class=["']guide-title["']>([\s\S]*?)<\/h1>/i, `<h1 class="guide-title">${headline}</h1>`);
      html = html.replace(/<title>([^<]+)<\/title>/i, `<title>${headline} | 家宽导航</title>`);
    }
  }

  fs.writeFileSync(targetFile, html, 'utf8');

  // 如果 dist 目录存在，同步写入 dist
  if (fs.existsSync(path.resolve(ROOT_DIR, 'dist'))) {
    try {
      ensureDir(path.resolve(ROOT_DIR, 'dist/guides'));
      fs.writeFileSync(path.resolve(ROOT_DIR, 'dist/guides', cleanFilename), html, 'utf8');
    } catch (e) {}
  }

  // 同步更新 index.html 中的知识专题集群卡片
  if (addToIndex && fs.existsSync(INDEX_HTML_FILE)) {
    let indexHtml = fs.readFileSync(INDEX_HTML_FILE, 'utf8');
    const clusterGridRegex = /(<div class=["']seo-cluster-grid["']>)([\s\S]*?)(<\/div>\s*<\/article>)/i;
    const match = indexHtml.match(clusterGridRegex);
    if (match) {
      const gridContent = match[2];
      const targetHref = `guides/${cleanFilename}`;
      if (!gridContent.includes(targetHref)) {
        const newCard = `                        <a href="${targetHref}" class="seo-cluster-card">
                            <div>
                                <h3>${headline || cleanFilename}</h3>
                                <p>${homeDesc || description || ''}</p>
                            </div>
                            <span class="seo-cluster-link-text">阅读完整指南 →</span>
                        </a>\n`;
        const newGridContent = gridContent.trimEnd() + '\n' + newCard + '                    ';
        indexHtml = indexHtml.replace(clusterGridRegex, `$1\n${newGridContent}$3`);
        fs.writeFileSync(INDEX_HTML_FILE, indexHtml, 'utf8');
      }
    }
  }

  return { success: true, filename: cleanFilename };
}

/**
 * 删除单个深度指南文章
 */
export function deleteGuideArticle(filename) {
  ensureDir(GUIDES_DIR);
  let cleanFilename = path.basename(filename).trim();
  if (!cleanFilename.endsWith('.html')) cleanFilename += '.html';
  const targetFile = path.resolve(GUIDES_DIR, cleanFilename);

  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile);
  }
  const distFile = path.resolve(ROOT_DIR, 'dist/guides', cleanFilename);
  if (fs.existsSync(distFile)) {
    try { fs.unlinkSync(distFile); } catch (e) {}
  }

  // 从 index.html 中移除卡片
  if (fs.existsSync(INDEX_HTML_FILE)) {
    let indexHtml = fs.readFileSync(INDEX_HTML_FILE, 'utf8');
    const cardRegex = new RegExp(`\\s*<a href=["']guides\\/${cleanFilename}["'][\\s\\S]*?<\\/a>`, 'i');
    if (cardRegex.test(indexHtml)) {
      indexHtml = indexHtml.replace(cardRegex, '');
      fs.writeFileSync(INDEX_HTML_FILE, indexHtml, 'utf8');
    }
  }

  return { success: true, filename: cleanFilename };
}

/**
 * 保存上传的图标
 */
export function saveUploadedIcon(filename, base64Data) {
  ensureDir(ICONS_DIR);
  // 清洗文件名
  const cleanName = filename.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  const targetPath = path.resolve(ICONS_DIR, cleanName);

  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(targetPath, buffer);

  return {
    success: true,
    filename: cleanName,
    path: `images/icons/${cleanName}`
  };
}

/**
 * 删除图标
 */
export function deleteUploadedIcon(filename) {
  ensureDir(ICONS_DIR);
  const cleanName = path.basename(filename).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  const targetPath = path.resolve(ICONS_DIR, cleanName);

  if (!targetPath.startsWith(ICONS_DIR)) {
    throw new Error('非法文件路径');
  }
  if (!fs.existsSync(targetPath)) {
    throw new Error(`图标 ${cleanName} 不存在`);
  }
  fs.unlinkSync(targetPath);

  // 如果 dist/assets 或 dist/images/icons 存在也清理
  const distIcon = path.resolve(ROOT_DIR, 'dist/images/icons', cleanName);
  if (fs.existsSync(distIcon)) {
    try { fs.unlinkSync(distIcon); } catch (e) {}
  }

  return { success: true, filename: cleanName };
}

/**
 * 并发链接存活体检器
 */
export async function checkLinkHealth(urls = []) {
  const results = [];
  const timeoutMs = 8000;

  async function checkSingle(url) {
    if (!url || !url.startsWith('http')) {
      return { url, status: 0, ok: false, error: '无效网址' };
    }
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      const timeMs = Date.now() - start;
      return {
        url,
        status: resp.status,
        ok: resp.status >= 200 && resp.status < 400,
        timeMs
      };
    } catch (err) {
      return {
        url,
        status: 0,
        ok: false,
        error: err.name === 'AbortError' ? '请求超时 (8s)' : err.message,
        timeMs: Date.now() - start
      };
    }
  }

  // 控制并发数为 6，避免被目标平台误判为恶意攻击
  const concurrency = 6;
  for (let i = 0; i < urls.length; i += concurrency) {
    const chunk = urls.slice(i, i + concurrency);
    const chunkRes = await Promise.all(chunk.map(checkSingle));
    results.push(...chunkRes);
  }

  return results;
}

/**
 * Git 一键 Commit & Push 联动
 */
export function gitCommitAndPush(commitMessage = 'chore: update content via CMS') {
  return new Promise((resolve, reject) => {
    const safeMsg = commitMessage.replace(/"/g, '\\"');
    const cmd = `git add . && git commit -m "${safeMsg}" && git push`;

    exec(cmd, { cwd: ROOT_DIR }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`Git 执行失败: ${stderr || stdout || err.message}`));
      }
      resolve({ stdout, stderr });
    });
  });
}
