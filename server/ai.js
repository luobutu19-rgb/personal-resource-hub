import fs from 'node:fs';
import { getSettings } from './settings.js';
import { canSummarize, extractText, absPathOf, isImageExt } from './text.js';
import { fetchLinkContent } from './collect.js';

const IMAGE_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

function imageDataUrl(item) {
  const filePath = absPathOf(item);
  const size = fs.statSync(filePath).size;
  if (size > 8 * 1024 * 1024) throw new Error('图片超过 8MB，暂不支持 AI 读取');
  const buffer = fs.readFileSync(filePath);
  const mime = IMAGE_MIME[String(item.ext || '').toLowerCase()] || 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function aiConfig({ requireEnabled = true } = {}) {
  const ai = getSettings().ai;
  if (requireEnabled && !ai.enabled) throw new Error('AI 尚未启用，请先在设置中开启');
  if (!ai.apiKey) throw new Error('尚未填写 API Key，请先在设置中配置');
  if (!ai.baseURL) throw new Error('尚未填写 AI 接口地址');
  return ai;
}

async function requestChat(ai, messages, maxTokens, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${ai.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
        messages,
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      let detail = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.error?.message || parsed?.message || detail;
      } catch {}
      throw new Error(`AI 服务返回 ${response.status}：${detail}`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('AI 服务返回了无法解析的内容');
    }

    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    const reasoning = choice?.message?.reasoning_content;

    return {
      content: typeof content === 'string' ? content.trim() : '',
      finish: choice?.finish_reason || '',
      reasoning: typeof reasoning === 'string' ? reasoning : '',
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('AI 请求超时，请稍后重试');
    if (err.message === 'fetch failed') throw new Error('AI 接口连接失败，请检查地址与网络');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function chat(messages, { timeout = 60000, maxTokens = 400 } = {}) {
  const ai = aiConfig();
  const isReasoner = /reasoner|\br1\b|think/i.test(ai.model);
  const budget = isReasoner ? Math.max(maxTokens * 3, 2500) : maxTokens;

  let result = await requestChat(ai, messages, budget, timeout);

  if (!result.content && (result.finish === 'length' || result.reasoning)) {
    result = await requestChat(ai, messages, Math.max(budget * 2, 4096), Math.max(timeout, 90000));
  }

  if (!result.content) {
    if (result.finish === 'length') {
      throw new Error('AI 输出被长度限制截断，请改用 deepseek-chat 模型或重试');
    }
    throw new Error('AI 未返回内容');
  }
  return result.content;
}

export function parseJSON(content) {
  const cleaned = String(content)
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI 返回的内容不是有效 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function summarizeFile(item) {
  if (!canSummarize(item.ext)) {
    throw new Error('该文件类型暂不支持内容总结（支持文本、PDF、Word/PPT/Excel 与图片）');
  }
  if (isImageExt(item.ext)) {
    const content = await chat(
      [
        {
          role: 'system',
          content:
            '你是学生资料整理助手。请用不超过120字的中文描述这张图片的内容；如果图中有题目、笔记或文字，请概括要点。直接输出摘要正文，不要标题、不要引号、不要 Markdown。',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `文件名：${item.originalName}` },
            { type: 'image_url', image_url: { url: imageDataUrl(item) } },
          ],
        },
      ],
      { timeout: 90000, maxTokens: 400 }
    );
    return content.replace(/\s+/g, ' ').slice(0, 240);
  }

  const text = (await extractText(item)).trim();
  if (!text) throw new Error('没有从文件中读到可总结的文字');

  const content = await chat(
    [
      {
        role: 'system',
        content:
          '你是学生资料整理助手。请用简洁的中文总结资料内容，不超过120字。直接输出摘要正文，不要标题、不要引号、不要 Markdown。',
      },
      {
        role: 'user',
        content: `文件名：${item.originalName}\n内容片段：\n${text.slice(0, 6000)}`,
      },
    ],
    { timeout: 90000, maxTokens: 300 }
  );

  return content.replace(/\s+/g, ' ').slice(0, 240);
}

export async function summarizeLink(item) {
  if (!item?.url) throw new Error('这个收藏没有可用的链接');

  let page = null;
  try {
    page = await fetchLinkContent(item.url);
  } catch {
    page = null;
  }

  const description = String(item.summary || '').trim();
  const metaDescription = String(page?.description || '').trim();
  const body = String(page?.text || '').trim();
  const bodyLength = body.replace(/\s+/g, '').length;

  if (bodyLength < 80 && !description && !metaDescription) {
    throw new Error('没能读取到网页正文（可能需要登录或平台限制），可以打开原文复制内容后手动编辑简介');
  }

  const parts = [`链接：${item.url}`];
  if (item.title) parts.push(`标题：${item.title}`);
  if (description) parts.push(`收藏时的简介：${description}`);
  if (metaDescription && metaDescription !== description) parts.push(`网页描述：${metaDescription}`);
  if (body) parts.push(`正文片段：\n${body.slice(0, 6000)}`);

  const content = await chat(
    [
      {
        role: 'system',
        content:
          '你是学生资料整理助手。请根据网页的标题、简介和正文，用不超过120字的中文概括它的核心内容与值得记住的要点；如果是视频或教程，概括主题和主要结论。直接输出摘要正文，不要标题、不要引号、不要 Markdown。',
      },
      { role: 'user', content: parts.join('\n') },
    ],
    { timeout: 90000, maxTokens: 400 }
  );

  return content.replace(/\s+/g, ' ').slice(0, 240);
}

export async function suggestMeta(item, existingTopics = []) {
  let snippet = '';
  if (!isImageExt(item.ext)) {
    try {
      snippet = (await extractText(item)).trim().slice(0, 1500);
    } catch {}
  }

  const topicsHint = existingTopics.length
    ? `已有主题：${existingTopics.slice(0, 20).join('、')}。只有在语义确实相符时才归入已有主题；不要为了复用而把文件套进不相关的主题。都不合适时新建一个不超过 8 个字的主题，避免近义重复。`
    : '';

  let userContent =
    item.kind === 'link'
      ? `网页收藏：${item.title || item.url || '未命名'}\n链接：${item.url || ''}\n简介：${String(item.summary || '').slice(0, 300)}`
      : `本地文件：${item.originalName}\n格式：${item.ext || '未知'}\n大小：${item.size} 字节${
          snippet ? `\n内容片段：\n${snippet}` : ''
        }`;

  if (isImageExt(item.ext)) {
    try {
      userContent = [
        { type: 'text', text: userContent },
        { type: 'image_url', image_url: { url: imageDataUrl(item) } },
      ];
    } catch {
      userContent = String(userContent);
    }
  }

  const content = await chat(
    [
      {
        role: 'system',
        content:
          '你是资料归档助手。根据文件名、内容片段或图片，建议主题、规范化标题、标签和类型。只输出严格 JSON，不要代码块，不要多余解释。格式：{"topic":"","title":"","tags":[],"category":""}。' +
          'category 必须是 图片/文档/视频/音频/压缩包/代码/网页/其他 之一：按扩展名和内容判断，网页收藏默认「网页」，明显属于视频或音频平台的判为「视频」或「音频」。' +
          '「网页」只用于网页收藏；本地文件即使格式未知，也不要判成网页，实在无法判断时用「其他」。' +
          'title 是整理后的文件名（不含扩展名）：去掉「副本、最终版、v2、(1)、未命名」等冗余，保留课程、章节、年份等关键信息，用简洁中文，不超过30字，不要包含 / \\ : * ? " < > | 等字符。' +
          'tags 为 1-4 个短词。' +
          topicsHint,
      },
      { role: 'user', content: userContent },
    ],
    { timeout: 60000, maxTokens: 300 }
  );

  const parsed = parseJSON(content);
  return {
    topic: String(parsed.topic || '').trim().slice(0, 24),
    title: String(parsed.title || '').trim().slice(0, 60),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6) : [],
    category: String(parsed.category || '').trim(),
  };
}

export async function summarizeTopic(topic, files) {
  if (!files.length) throw new Error('该主题下还没有文件');

  const lines = files
    .slice(0, 40)
    .map((file) => {
      const tags = (file.tags || []).length ? `；标签：${file.tags.join('、')}` : '';
      const summary = file.summary ? `；摘要：${file.summary.slice(0, 80)}` : '';
      return `- ${file.title}（${file.category}${tags}${summary}）`;
    })
    .join('\n');

  const content = await chat(
    [
      {
        role: 'system',
        content:
          '你是学生的资料管理助手。请根据一个主题下的文件清单，用不超过150字的中文概括：这组资料包含什么、重点在哪里、适合怎么复习或使用。直接输出正文，不要标题、不要引号、不要 Markdown、不要分点编号。',
      },
      {
        role: 'user',
        content: `主题：${topic}\n共 ${files.length} 个文件：\n${lines}`,
      },
    ],
    { timeout: 70000, maxTokens: 400 }
  );

  return content.replace(/\s+/g, ' ').slice(0, 320);
}

export async function searchFiles(query, files) {
  const candidates = files
    .slice()
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, 150);

  const catalog = candidates
    .map((file, index) => {
      const tags = (file.tags || []).length ? `｜标签:${file.tags.join(',')}` : '';
      const digest = file.summary || file.aiSummary || '';
      const summary = digest ? `｜摘要:${digest.slice(0, 60)}` : '';
      return `${index + 1}｜${file.title}｜主题:${file.topic}｜类型:${file.category}${tags}${summary}`;
    })
    .join('\n');

  const content = await chat(
    [
      {
        role: 'system',
        content:
          '你是学生的资料检索助手。根据用户的自然语言需求，从给定文件清单中挑选最相关的文件。只输出严格 JSON，不要代码块或其他文字。格式：{"matches":[{"id":"清单前的序号","reason":"不超过20字的中文理由"}]}。最多 8 条，按相关度排序；没有相关文件就返回 {"matches":[]}。id 必须是清单里出现过的数字序号。',
      },
      {
        role: 'user',
        content: `用户需求：${query}\n\n文件清单（每行开头是序号）：\n${catalog}`,
      },
    ],
    { timeout: 50000, maxTokens: 500 }
  );

  const parsed = parseJSON(content);
  const seen = new Set();
  return (Array.isArray(parsed.matches) ? parsed.matches : [])
    .map((match) => {
      const index = Number.parseInt(String(match?.id ?? ''), 10) - 1;
      const file = candidates[index];
      if (!file) return null;
      return { id: file.id, reason: String(match?.reason || '').trim().slice(0, 40) };
    })
    .filter((match) => match && !seen.has(match.id) && seen.add(match.id))
    .slice(0, 8);
}

export async function testConnection() {
  aiConfig({ requireEnabled: false });
  await chat([{ role: 'user', content: '请只回复：OK' }], { timeout: 20000, maxTokens: 10 });
  return true;
}
