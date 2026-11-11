import fs from 'node:fs';
import { allFiles, stats } from './store.js';
import { getExamData } from './exams.js';
import { listMistakes } from './mistakes.js';
import { getSettings } from './settings.js';
import { chat } from './ai.js';
import { canSummarize, extractText, isImageExt, absPathOf } from './text.js';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayDiff(target) {
  const a = new Date(`${todayKey()}T00:00:00`);
  const b = new Date(`${target}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

export function buildContext() {
  const exams = getExamData();
  const today = todayKey();
  const nextExam = (exams.exams || [])
    .filter((exam) => exam?.date && exam.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;

  const tasks = exams.plan?.tasks || [];
  const todayTasks = tasks.filter((task) => task.date === today);
  const doneToday = todayTasks.filter((task) => task.done).length;

  const mistakes = listMistakes();
  const openMistakes = mistakes.filter((item) => item.status !== 'mastered');
  const weakMistakes = openMistakes.slice(0, 5).map((item) => item.question).filter(Boolean);

  const files = allFiles().filter((file) => !file.hidden);
  const stat = stats();
  const recent = files
    .slice()
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, 5)
    .map((file) => ({ title: file.title, topic: file.topic, category: file.category }));

  const aiEnabled = Boolean(getSettings().ai?.enabled && getSettings().ai?.apiKey);

  return {
    aiEnabled,
    totalFiles: stat.total ?? files.length,
    topics: (stat.topics || []).slice(0, 4).map((topic) => ({ name: topic.name, count: topic.count })),
    recent,
    exam: nextExam ? { name: nextExam.name, date: nextExam.date, daysLeft: dayDiff(nextExam.date) } : null,
    todayTasks: { done: doneToday, total: todayTasks.length },
    openMistakes: openMistakes.length,
    weakQuestions: weakMistakes,
  };
}

// 规则驱动的主动建议（无 AI 也能用）
const DAILY_TIPS = [
  '今天试试 25 分钟专注 + 5 分钟休息，四轮下来比熬夜两小时管用。',
  '睡前 10 分钟把今天学的内容默念一遍，比早上重读一遍记得牢。',
  '错题别重做整道题，先只看错因，能说清错在哪就算过。',
  '背书用「合上书回忆」而不是反复朗读，回忆一次顶读三遍。',
  '专注时把手机放到看不见的地方，这是最省力的一步。',
  '每科留 5 分钟做自测提问，比再多刷一套卷更有效。',
  '考前一周别开新题型，把会做的做到不丢分最划算。',
];

export function buildSuggestions(context) {
  const list = [];

  if (context.exam) {
    const { daysLeft, name } = context.exam;
    list.push({
      id: 'exam',
      tone: daysLeft <= 7 ? 'warn' : 'accent',
      title: daysLeft <= 7 ? `距${name}只剩 ${daysLeft} 天` : `距${name}还有 ${daysLeft} 天`,
      detail:
        daysLeft <= 7
          ? '最后一周建议只做三件事：过一遍错题、默写核心公式、保证睡眠。'
          : '按现在的节奏推进即可，别把复习堆到考前三天。',
      action: { label: '看复习计划', href: '/exam.html#plan' },
    });
  }

  if (context.todayTasks.total) {
    const { done, total } = context.todayTasks;
    if (done < total) {
      list.push({
        id: 'tasks',
        tone: 'accent',
        title: `今天还有 ${total - done} 项复习没勾`,
        detail: `已完成 ${done}/${total}。先挑最短的一项开始，动量比计划更重要。`,
        action: { label: '去勾任务', href: '/exam.html#plan' },
      });
    } else {
      list.push({
        id: 'tasks-done',
        tone: 'calm',
        title: '今天的复习都做完了',
        detail: '状态不错。可以花 10 分钟把今天的错题再快速扫一遍。',
        action: { label: '看错题本', href: '/exam.html#mistakes' },
      });
    }
  }

  if (context.openMistakes) {
    list.push({
      id: 'mistakes',
      tone: 'warn',
      title: `${context.openMistakes} 道错题还没掌握`,
      detail: context.weakQuestions[0]
        ? `例如「${String(context.weakQuestions[0]).slice(0, 28)}」，可以让我讲一遍思路。`
        : '错题不用重做全卷，只看错因就够。',
      action: { label: '打开错题本', href: '/exam.html#mistakes' },
    });
  }

  const dayIndex = Math.floor((Date.now() + 8 * 3600 * 1000) / 86400000);
  const tip = DAILY_TIPS[dayIndex % DAILY_TIPS.length];
  list.push({
    id: `tip-${dayIndex}`,
    tone: 'calm',
    title: '今日小建议',
    detail: tip,
    action: { label: '再来一条', prompt: '再给我一条今天的学习建议，要具体可执行' },
  });

  if (context.recent.length) {
    const latest = context.recent[0];
    list.push({
      id: 'recent',
      tone: 'accent',
      title: `最近存了「${latest.title}」`,
      detail: '刚存的资料当天消化最省力：花 5 分钟扫一遍，再问问我有没有可以补充的重点。',
      action: { label: '去资料库', href: '/' },
    });
  }

  if (context.topics.length) {
    const topic = context.topics[0];
    list.push({
      id: 'topic',
      tone: 'accent',
      title: `「${topic.name}」里有 ${topic.count} 份资料`,
      detail: '资料攒多了容易变成收藏夹。可以让我帮你总结重点，或者删掉重复的。',
      action: { label: '让我总结', prompt: `帮我总结一下「${topic.name}」主题下的资料重点` },
    });
  }

  if (!context.totalFiles) {
    list.push({
      id: 'empty',
      tone: 'calm',
      title: '资料库还是空的',
      detail: '先把今天的卷子或笔记拍照上传，我才能帮你分析和安排复习。',
      action: { label: '回主页上传', href: '/' },
    });
  }

  return list.slice(0, 8);
}

const MAX_FILES = 3;
const MAX_FILE_CHARS = 6000;

// 读取用户引用的文件内容（文本类抽正文，图片走视觉）
export async function loadFileContext(fileIds) {
  const ids = new Set((Array.isArray(fileIds) ? fileIds : []).map(String));
  if (!ids.size) return { text: '', images: [] };

  const files = allFiles()
    .filter((file) => !file.hidden && ids.has(file.id))
    .slice(0, MAX_FILES);

  const blocks = [];
  const images = [];

  for (const file of files) {
    const header = `《${file.title}》（${file.category}${file.ext ? ` · ${file.ext}` : ''}）`;

    if (isImageExt(file.ext)) {
      try {
        const buffer = fs.readFileSync(absPathOf(file));
        if (buffer.length <= 8 * 1024 * 1024) {
          const mime = file.mime || 'image/jpeg';
          images.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` },
          });
          blocks.push(`${header}：这是一张图片，请直接看图回答。`);
        } else {
          blocks.push(`${header}：图片太大（超过 8MB），无法读取。`);
        }
      } catch {
        blocks.push(`${header}：图片读取失败。`);
      }
      continue;
    }

    if (canSummarize(file.ext)) {
      try {
        const text = (await extractText(file)).trim();
        blocks.push(text ? `${header}：\n${text.slice(0, MAX_FILE_CHARS)}` : `${header}：没有读到文字内容。`);
      } catch (error) {
        blocks.push(`${header}：读取失败（${error.message}）。`);
      }
      continue;
    }

    blocks.push(`${header}：这个格式暂时读不了正文，可以告诉我文件名后我按类型给建议。`);
  }

  return { text: blocks.join('\n\n'), images };
}

function contextPrompt(context) {
  const lines = [
    `资料库 ${context.totalFiles} 个文件${context.topics.length ? `，主要主题：${context.topics.map((t) => `${t.name}(${t.count})`).join('、')}` : ''}`,
  ];
  if (context.exam) lines.push(`最近考试：${context.exam.name}，${context.exam.date}，还有 ${context.exam.daysLeft} 天`);
  lines.push(`今日复习任务：完成 ${context.todayTasks.done}/${context.todayTasks.total}`);
  lines.push(`待巩固错题：${context.openMistakes} 道`);
  if (context.recent.length) lines.push(`最近上传：${context.recent.map((file) => file.title).join('、')}`);
  if (context.weakQuestions.length) {
    lines.push(`部分错题题干：${context.weakQuestions.map((q) => String(q).slice(0, 40)).join(' / ')}`);
  }
  return lines.join('\n');
}

export async function askAssistant(messages, fileIds) {
  const context = buildContext();
  if (!context.aiEnabled) {
    throw Object.assign(new Error('AI 还没启用：先到设置里填写接口、模型和 API Key'), { status: 400 });
  }

  const history = (Array.isArray(messages) ? messages : [])
    .filter((item) => item && ['user', 'assistant'].includes(item.role) && String(item.content || '').trim())
    .slice(-8)
    .map((item) => ({ role: item.role, content: String(item.content).slice(0, 2000) }));

  if (!history.length) throw Object.assign(new Error('说点什么吧'), { status: 400 });

  const files = await loadFileContext(fileIds);

  const system =
    '你是初三学生的私人 AI 伙伴，语气像靠谱的学长和朋友：简洁、真诚、不客套。' +
    '学习问题优先结合下面的资料库与复习数据回答；生活、兴趣、情绪、日常闲聊也可以正常聊，不要硬把话题拉回学习。' +
    '不确定的不要编造；涉及健康或安全的重要问题时提醒他找家长或老师。' +
    '回答控制在 200 字以内，需要步骤时用短句分点。不要用 Markdown 标题。\n\n' +
    `【当前数据】\n${contextPrompt(context)}` +
    (files.text
      ? `\n\n【用户这次引用的文件内容】\n${files.text}\n\n引用文件时：优先依据文件内容回答，并说明结论来自哪份文件；文件里没有的信息要直说没有。`
      : '');

  const payload = [{ role: 'system', content: system }];

  if (files.images.length) {
    payload.push({
      role: 'user',
      content: [{ type: 'text', text: '（下面是我这次引用的图片，请结合图片回答）' }, ...files.images],
    });
  }

  payload.push(...history);

  return chat(payload, { timeout: 90000, maxTokens: 900 });
}
