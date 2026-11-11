export const CATEGORIES = ['图片', '文档', '视频', '音频', '压缩包', '代码', '网页', '其他'];

const EXT_CATEGORY = {
  图片: 'jpg jpeg jfif png gif webp svg heic heif bmp avif tiff tif ico psd ai eps raw cr2 nef arw dng jp2',
  文档: 'pdf doc docx txt md markdown rtf ppt pptx pps xls xlsx csv numbers pages key odt ods odp epub mobi azw3 djvu xps wps et dps',
  视频: 'mp4 mov m4v avi mkv webm flv wmv 3gp mts m2ts rm rmvb ogv m2v',
  音频: 'mp3 wav m4a m4b aac flac ogg opus wma ape amr mid midi aiff aif',
  压缩包: 'zip rar 7z tar gz tgz bz2 xz z cab iso',
  代码: 'js mjs cjs ts tsx jsx vue svelte py java c h cpp hpp cs go rs php rb sh bat ps1 sql html htm css scss sass less json yml yaml xml ipynb kt kts swift dart lua r',
};

const CATEGORY_MAP = {};
for (const [category, exts] of Object.entries(EXT_CATEGORY)) {
  for (const ext of exts.split(' ')) CATEGORY_MAP[ext] = category;
}

// 主题规则：越具体的放前面，命中即停
export const TOPIC_RULES = [
  { topic: '线性代数', words: ['线性代数', '线代', '矩阵', '行列式', '特征值', '向量组'] },
  { topic: '概率论', words: ['概率论', '概率统计', '数理统计', '随机变量', '大数定律'] },
  { topic: '高数', words: ['高数', '高等数学', '微积分', '极限', '导数', '微分', '积分', '级数'] },
  { topic: '大学物理', words: ['大学物理', '物理', '力学', '电磁学', '光学', '热学'] },
  { topic: '英语', words: ['英语', '四级', '六级', 'cet4', 'cet6', '雅思', '托福', 'ielts', 'toefl', '单词', '听力', '阅读理解', '口语'] },
  { topic: '化学', words: ['化学', '有机化学', '无机化学', '分析化学'] },
  { topic: '生物', words: ['生物', '细胞', '遗传', '生态'] },
  { topic: '政治', words: ['政治', '马原', '毛概', '思修', '近代史', '马克思主义'] },
  { topic: '算法与数据结构', words: ['算法', '数据结构', 'leetcode', '刷题', '复杂度'] },
  { topic: '计算机网络', words: ['计算机网络', '网络原理', 'tcp', 'http', 'osi', '路由'] },
  { topic: '操作系统', words: ['操作系统', 'linux', '进程', '线程', '内核'] },
  { topic: '数据库', words: ['数据库', 'mysql', 'sql', 'redis', 'mongodb'] },
  { topic: '计算机编程', words: ['编程', '代码', 'c语言', 'c++', 'python', 'java', 'javascript', 'typescript', '前端', '后端', 'react', 'vue', 'html', 'css'] },
  { topic: '毕业论文', words: ['毕业论文', '毕设', '论文', 'thesis', 'dissertation', '文献综述'] },
  { topic: '求职', words: ['简历', '求职', '实习', '面试', 'offer', 'resume', 'cv', '招聘'] },
  { topic: '竞赛', words: ['竞赛', '比赛', '数学建模', 'acm', '挑战杯', '蓝桥杯', '大创'] },
  { topic: '证书考试', words: ['证书', '考试', '真题', '试卷', '复习', '考证'] },
  { topic: '社团活动', words: ['社团', '活动', '策划', '会议记录', '例会'] },
];

export const TAG_RULES = [
  { tag: '笔记', words: ['笔记', 'note', 'notes', '整理'] },
  { tag: '课件', words: ['课件', 'ppt', '讲义', 'slides', '演示'] },
  { tag: '作业', words: ['作业', 'homework', 'assignment', '习题'] },
  { tag: '论文', words: ['论文', 'paper', 'essay', 'thesis'] },
  { tag: '真题', words: ['真题', '试卷', '答案', 'exam', 'quiz', '模拟题'] },
  { tag: '简历', words: ['简历', 'resume', 'cv'] },
  { tag: '截图', words: ['截图', 'screenshot', '截屏', 'screen shot'] },
  { tag: '照片', words: ['照片', 'photo', 'img_', 'dsc_'] },
  { tag: '录音', words: ['录音', 'recording', 'voice', 'memo'] },
  { tag: '代码', words: ['源码', '代码', 'source code', 'code'] },
  { tag: '项目', words: ['项目', 'project'] },
  { tag: '证书', words: ['证书', '证明', 'certificate'] },
];

const GENERIC_FOLDERS = new Set([
  'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'temp', 'tmp', 'files',
  '桌面', '文档', '下载', '图片', '音乐', '视频', '文件', '新建文件夹', 'untitled folder', 'wechat files',
]);

export function getExt(name) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

export function categoryOf(ext) {
  return CATEGORY_MAP[String(ext || '').toLowerCase()] || '其他';
}

export function cleanTitle(baseName) {
  const name = String(baseName || '未命名');
  const stem = name.replace(/\.[^.]+$/, '');
  let title = stem.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title) title = name;
  return title.slice(0, 80);
}

function isGenericFolder(name) {
  const lower = name.toLowerCase();
  return (
    !lower ||
    GENERIC_FOLDERS.has(lower) ||
    /^\d+$/.test(lower) ||
    /^\d{4}[-_.年]\d{1,2}/.test(lower) ||
    /^(新建|未命名)/.test(name)
  );
}

function keywordHit(haystack, word) {
  const target = String(word || '').toLowerCase();
  if (!target) return false;
  if (/[a-z]/i.test(target)) {
    const pattern = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(haystack);
  }
  return haystack.includes(target);
}

export function detectTopic(fullPath) {
  const segments = String(fullPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const folders = segments.slice(0, -1);
  const haystack = `${segments.join(' ')}`.toLowerCase();

  if (folders.length) {
    const hint = folders[0].trim();
    if (hint.length <= 24 && !isGenericFolder(hint)) return hint.slice(0, 24);
  }
  for (const rule of TOPIC_RULES) {
    if (rule.words.some((word) => keywordHit(haystack, word))) return rule.topic;
  }
  return '未分类';
}

export function detectTags(fullPath) {
  const haystack = String(fullPath || '').replace(/\\/g, '/');
  const lower = haystack.toLowerCase();
  const tags = new Set();

  for (const rule of TAG_RULES) {
    if (rule.words.some((word) => keywordHit(lower, word))) tags.add(rule.tag);
  }

  const year = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.exec(haystack);
  if (year) tags.add(year[1]);

  const chapter = /第[一二三四五六七八九十百零\d]{1,4}[章节讲]/.exec(haystack);
  if (chapter) tags.add(chapter[0]);
  else {
    const ch = /\bch(?:apter)?\.?\s*(\d{1,3})\b/i.exec(haystack);
    if (ch) tags.add(`Ch.${ch[1]}`);
  }

  return [...tags].slice(0, 6);
}

export function classify(fullName) {
  const segments = String(fullName || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const baseName = segments.pop() || '未命名';
  const fullPath = [...segments, baseName].join('/');
  const ext = getExt(baseName);

  return {
    baseName,
    ext,
    title: cleanTitle(baseName),
    topic: detectTopic(fullPath),
    category: categoryOf(ext),
    tags: detectTags(fullPath),
  };
}
