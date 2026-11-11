import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR, TMP_DIR, allFiles, addFile } from './store.js';
import { classify } from './classifier.js';
import { moveIntoLibrary, hashFile } from './upload.js';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAX_HTML = 800000;
const COVER_DIR = path.join(DATA_DIR, 'covers');
const MAX_COVER_BYTES = 3 * 1024 * 1024;

const PLATFORMS = [
  { key: 'bilibili', name: '哔哩哔哩', hosts: ['bilibili.com', 'b23.tv'] },
  { key: 'xiaohongshu', name: '小红书', hosts: ['xiaohongshu.com', 'xhslink.com'] },
  { key: 'wechat', name: '微信', hosts: ['weixin.qq.com', 'mp.weixin.qq.com'] },
  { key: 'instagram', name: 'Instagram', hosts: ['instagram.com', 'instagr.am'] },
];

const JUNK_TITLES = new Set([
  '',
  'instagram',
  'login • instagram',
  'login',
  '小红书',
  '小红书 - 你的生活指南',
  '微信公众平台',
  '微信',
  'bilibili',
  '哔哩哔哩',
]);

function decodeEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

export function extractFirstUrl(text) {
  const match = /https?:\/\/[^\s"'<>）)】]+/i.exec(String(text || ''));
  if (!match) return '';
  return match[0].replace(/[.,;!?，。；！？]+$/g, '');
}

function normalizeUrl(raw) {
  let value = String(raw || '').trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const parsed = new URL(value);
  parsed.hash = '';

  const drop = [];
  for (const key of parsed.searchParams.keys()) {
    if (/^utm_/i.test(key) || ['spm_id_from', 'from_source', 'share_source', 'share_medium', 'vd_source'].includes(key)) {
      drop.push(key);
    }
  }
  drop.forEach((key) => parsed.searchParams.delete(key));

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function canonicalUrl(url) {
  const parsed = new URL(url);
  parsed.searchParams.sort();
  return parsed.toString();
}

export function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return (
      PLATFORMS.find((platform) => platform.hosts.some((item) => host === item || host.endsWith(`.${item}`))) || {
        key: 'web',
        name: '网页',
      }
    );
  } catch {
    return { key: 'web', name: '网页' };
  }
}

function cleanTitle(title) {
  return decodeEntities(title)
    .replace(/\s+/g, ' ')
    .replace(/\s*[-_|–]\s*(哔哩哔哩|bilibili|小红书|微信公众平台|微信|Instagram)\s*$/i, '')
    .trim()
    .slice(0, 120);
}

function isJunkTitle(title) {
  const value = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return JUNK_TITLES.has(value) || value.length < 3;
}

function titleFromText(text) {
  const withoutUrls = String(text || '').replace(/https?:\/\/\S+/g, ' ');
  for (const line of withoutUrls.split(/[\n\r]+/)) {
    let value = line
      .replace(/复制本条信息.*$/i, '')
      .replace(/打开【?小红书】?.*$/i, '')
      .replace(/打开.*App.*$/i, '')
      .replace(/^(分享|推荐|来自)\s*[:：]?\s*/i, '')
      .replace(/[，,。;；\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (value.length >= 4 && value.length <= 120) return value;
  }
  return '';
}

async function fetchText(url, { timeout = 12000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        ...headers,
      },
    });
    const contentType = (response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    // 音视频不需要按文本读取，交给下载流程
    if (contentType && !/^(text\/|application\/(json|xml|xhtml))/i.test(contentType)) {
      try {
        await response.body?.cancel();
      } catch {}
      return { ok: response.ok, status: response.status, finalUrl: response.url || url, contentType, text: '' };
    }
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
      contentType,
      text: text.slice(0, MAX_HTML),
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('抓取网页超时');
    throw new Error('无法访问这个链接');
  } finally {
    clearTimeout(timer);
  }
}

function metaContent(html, keys) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const first = new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`,
      'i'
    ).exec(html);
    const second = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`,
      'i'
    ).exec(html);
    if (first) return decodeEntities(first[1]).trim();
    if (second) return decodeEntities(second[1]).trim();
  }
  return '';
}

function parsePageMeta(html) {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = metaContent(html, ['og:title', 'twitter:title']) || (titleTag ? decodeEntities(titleTag[1]) : '');
  const description = metaContent(html, ['og:description', 'description', 'twitter:description']);
  let image = metaContent(html, ['og:image', 'twitter:image', 'twitter:image:src']);
  if (image.startsWith('//')) image = `https:${image}`;

  return {
    title: cleanTitle(title),
    description: description.slice(0, 500),
    image,
  };
}

function htmlToText(html) {
  let body = String(html || '');
  const article = /<article[\s\S]*?<\/article>/i.exec(body) || /<main[\s\S]*?<\/main>/i.exec(body);
  if (article && article[0].length > 500) body = article[0];

  body = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeEntities(body)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export async function fetchLinkContent(rawUrl) {
  const target = normalizeUrl(rawUrl);
  const page = await fetchText(target, { timeout: 15000 });
  if (!page.ok) {
    const error = new Error(`网页返回 ${page.status}，无法读取内容`);
    error.status = 400;
    throw error;
  }

  const meta = parsePageMeta(page.text);
  const text = htmlToText(page.text).slice(0, 12000);
  return {
    title: meta.title,
    description: meta.description,
    text,
    finalUrl: page.finalUrl,
  };
}

async function bilibiliMeta(finalUrl) {
  const match = /(BV[0-9A-Za-z]{10})/.exec(finalUrl);
  if (!match) return null;

  try {
    const { text } = await fetchText(`https://api.bilibili.com/x/web-interface/view?bvid=${match[1]}`, {
      timeout: 8000,
      headers: { Referer: 'https://www.bilibili.com/' },
    });
    const data = JSON.parse(text);
    if (data.code !== 0 || !data.data) return null;
    return {
      title: cleanTitle(data.data.title || ''),
      description: String(data.data.desc || '').slice(0, 500),
      image: String(data.data.pic || ''),
    };
  } catch {
    return null;
  }
}

async function downloadCover(imageUrl, referer, id) {
  if (!imageUrl) return '';
  let url = String(imageUrl).trim();
  if (url.startsWith('//')) url = `https:${url}`;
  if (!/^https?:\/\//i.test(url)) return '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Referer: referer,
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
      },
    });
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return '';

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_COVER_BYTES) return '';

    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
        ? 'webp'
        : contentType.includes('gif')
          ? 'gif'
          : contentType.includes('avif')
            ? 'avif'
            : 'jpg';

    fs.mkdirSync(COVER_DIR, { recursive: true });
    const name = `${id}.${ext}`;
    fs.writeFileSync(path.join(COVER_DIR, name), buffer);
    return `covers/${name}`;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

const MEDIA_MIME_EXT = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
};

const MEDIA_EXT_HINT = /^(mp3|m4a|wav|aac|flac|ogg|opus|weba|mp4|mov|m4v|webm|mkv)$/i;
const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;

function extFromUrl(url) {
  const match = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(String(url || ''));
  return match ? match[1].toLowerCase() : '';
}

function looksLikeMediaUrl(url) {
  return MEDIA_EXT_HINT.test(extFromUrl(url));
}

// 从网页 HTML 里找音频/视频地址
function extractMediaSrc(html, baseUrl) {
  const text = String(html || '');
  const candidates = [];

  const audioTag = /<audio[^>]*>([\s\S]*?)<\/audio>/gi;
  let audioMatch;
  while ((audioMatch = audioTag.exec(text))) {
    const src = /src=["']([^"']+)["']/i.exec(audioMatch[1]);
    if (src) candidates.push(src[1]);
    const source = /<source[^>]+src=["']([^"']+)["']/i.exec(audioMatch[1]);
    if (source) candidates.push(source[1]);
  }

  const inlineAudio = /<audio[^>]+src=["']([^"']+)["']/i.exec(text);
  if (inlineAudio) candidates.push(inlineAudio[1]);

  const ogAudio =
    /<meta[^>]+property=["']og:audio(?::url)?["'][^>]+content=["']([^"']+)["']/i.exec(text) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:audio(?::url)?["']/i.exec(text);
  if (ogAudio) candidates.push(ogAudio[1]);

  const declared = /["'](https?:\/\/[^"']+\.(?:mp3|m4a|wav|aac|flac|ogg|opus)(?:\?[^"']*)?)["']/i.exec(text);
  if (declared) candidates.push(declared[1]);

  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const absolute = new URL(raw, baseUrl).toString();
      if (/^https?:\/\//i.test(absolute)) return absolute;
    } catch {}
  }
  return '';
}

// 直接把 MP3 / 视频链接下载进资料库（iPhone 上粘贴链接即可收藏音频）
export async function downloadMediaToLibrary(rawUrl, hintExt = '') {
  let target;
  try {
    target = normalizeUrl(rawUrl);
  } catch {
    const error = new Error('链接格式不正确');
    error.status = 400;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);
  let tempPath = '';

  try {
    const response = await fetch(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'audio/*,video/*,*/*;q=0.8' },
    });
    if (!response.ok) throw new Error(`链接返回 ${response.status}，无法下载`);

    const contentType = (response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (!/^(audio|video)\//.test(contentType)) {
      throw new Error('这个链接不是音视频文件，可以改用普通网页收藏');
    }
    const extension = MEDIA_MIME_EXT[contentType] || hintExt || 'mp3';

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_MEDIA_BYTES) throw new Error('文件超过 1GB，无法下载到资料库');

    fs.mkdirSync(TMP_DIR, { recursive: true });
    tempPath = path.join(TMP_DIR, `dl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extension}`);

    let received = 0;
    const limiter = async function* (source) {
      for await (const chunk of source) {
        received += chunk.length;
        if (received > MAX_MEDIA_BYTES) throw new Error('文件超过 1GB，无法下载到资料库');
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(tempPath));

    const urlName = decodeURIComponent(new URL(response.url || target).pathname.split('/').pop() || '').trim();
    const fileName = /\.[a-z0-9]{2,5}$/i.test(urlName) ? urlName : `收藏音频.${extension}`;

    const hash = await hashFile(tempPath);
    const existing = allFiles().find((file) => file.hash === hash);
    if (existing) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {}
      return { item: existing, duplicate: true };
    }

    const item = moveIntoLibrary(tempPath, fileName, hash, contentType);
    addFile(item);
    return { item, duplicate: false };
  } catch (error) {
    try {
      if (tempPath && fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    } catch {}
    if (error.name === 'AbortError') throw new Error('下载超时，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function collectLink({ url, text, title, note } = {}) {
  const source = String(text || '');
  const rawLink = extractFirstUrl(url) || extractFirstUrl(source);
  if (!rawLink) {
    const error = new Error('没有找到链接，请粘贴包含 http(s) 链接的分享内容');
    error.status = 400;
    throw error;
  }

  let target;
  try {
    target = normalizeUrl(rawLink);
  } catch {
    const error = new Error('链接格式不正确');
    error.status = 400;
    throw error;
  }

  // 音视频直链：直接下载进资料库，而不是当成网页
  if (looksLikeMediaUrl(target)) {
    const media = await downloadMediaToLibrary(target, extFromUrl(target));
    return { ...media, media: true };
  }

  let page = null;
  let finalUrl = target;
  try {
    page = await fetchText(target);
    finalUrl = page.finalUrl || target;
  } catch {
    page = null;
  }

  // 短链接跳到音视频时，按下载处理
  if (page && /^(audio|video)\//i.test(page.contentType || '')) {
    const media = await downloadMediaToLibrary(finalUrl, extFromUrl(finalUrl));
    return { ...media, media: true };
  }

  // 网页里内嵌了音频/视频时，尝试把媒体文件取下来
  if (page && page.text) {
    const mediaUrl = extractMediaSrc(page.text, finalUrl);
    if (mediaUrl) {
      try {
        const media = await downloadMediaToLibrary(mediaUrl, extFromUrl(mediaUrl));
        return { ...media, media: true };
      } catch {
        // 取不到就退回普通网页收藏
      }
    }
  }

  const platform = detectPlatform(finalUrl);
  let meta = { title: '', description: '', image: '' };

  if (platform.key === 'bilibili') {
    const bili = await bilibiliMeta(finalUrl);
    if (bili) meta = { ...meta, ...bili };
  }

  if (page) {
    const parsed = parsePageMeta(page.text);
    if (!isJunkTitle(parsed.title)) {
      meta.title = meta.title || parsed.title;
      meta.description = meta.description || parsed.description;
      meta.image = meta.image || parsed.image;
    }
  }

  const sharedTitle = titleFromText(source);
  let finalTitle = cleanTitle(String(title || '').trim() || meta.title || sharedTitle || `${platform.name} 收藏`);
  if (isJunkTitle(finalTitle)) finalTitle = `${platform.name} 收藏`;

  const rawDescription = String(note || meta.description || '').trim();
  const description = /^[\s\-—–_·.。]*$/.test(rawDescription) ? '' : rawDescription.slice(0, 400);
  const classification = classify(
    `${finalTitle} ${source.replace(/https?:\/\/\S+/g, ' ')} ${description}`
  );
  const topic = classification.topic === '未分类' ? '网络收藏' : classification.topic;
  const tags = [...new Set([platform.name, ...classification.tags])].slice(0, 6);

  let canonical;
  try {
    canonical = canonicalUrl(finalUrl);
  } catch {
    canonical = target;
  }
  const hash = crypto.createHash('sha256').update(`url:${canonical}`).digest('hex');
  const existing = allFiles().find((file) => file.kind === 'link' && file.hash === hash);
  if (existing) return { item: existing, duplicate: true };

  const id = `f_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const coverPath = await downloadCover(meta.image, finalUrl, id);

  const item = {
    id,
    kind: 'link',
    originalName: finalTitle,
    title: finalTitle,
    storedName: '',
    relPath: '',
    topic,
    category: '网页',
    tags,
    summary: description,
    summaryStatus: 'none',
    ai: { suggested: false },
    size: 0,
    ext: '',
    mime: '',
    hash,
    favorite: false,
    createdAt: new Date().toISOString(),
    url: finalUrl,
    platform: platform.name,
    coverPath,
  };

  addFile(item);
  return { item, duplicate: false };
}
