const NEWS_WORD_RE = /(新闻|新聞|資訊|资讯|秩序|快讯|快訊|热点|熱點|动态|動態|news)/i;
const AI_WORD_RE = /(AI|AIA|AHA|人工智能|大模型|模型|OpenAI|Claude|Gemini|智能体|智能體|机器人|機器人|芯片|晶片|算力|夜夜圈|爷爷圈|爺爺圈)/i;
const AI_NEWS_FEEDS = [
  "https://venturebeat.com/category/ai/feed/",
  "https://www.technologyreview.com/topic/artificial-intelligence/feed/",
  "https://www.artificialintelligence-news.com/feed/",
  "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"
];

export async function maybeAnswerNewsQuestion({ prompt, fetchImpl = globalThis.fetch, now = new Date() }) {
  const text = normalizeNewsText(prompt);
  if (!isNewsQuestion(text)) return "";
  if (typeof fetchImpl !== "function") return "现在无法联网查询新闻：当前运行环境没有可用的 fetch。";

  const limit = requestedCount(text) || 8;
  const queries = buildNewsQueries(text, now);
  const items = [];
  const seen = new Set();

  for (const query of queries) {
    const found = await fetchNewsItems(query, fetchImpl).catch(() => []);
    for (const item of found) {
      const key = normalizeKey(item.title || item.link);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= limit) break;
    }
    if (items.length >= limit) break;
  }

  if (!items.length) {
    return `我没有查到可用的新闻结果。你可以换个关键词再试，比如：\`今天中美 AI 新闻\`。`;
  }

  return formatNewsAnswer(items.slice(0, limit), text);
}

export function isNewsQuestion(text) {
  const value = normalizeNewsText(text);
  return NEWS_WORD_RE.test(value) && (
    AI_WORD_RE.test(value)
    || /(美国|美國|中国|中國|中美|科技|互联网|互聯網|财经|財經|商业|商業)/.test(value)
    || /(热门|熱門|最热|最熱|发生|發生|重点|重點|总结|總結|梳理|查|搜)/.test(value)
  );
}

export function normalizeNewsText(prompt) {
  return String(prompt || "")
    .replace(/^音频转写[：:]\s*/gm, "")
    .replace(/(?:AIA|AHA)(?=(圈|的|新聞|新闻|資訊|资讯))/gi, "AI")
    .replace(/(夜夜圈|爷爷圈|爺爺圈)/g, "AI圈")
    .replace(/新闻秩序|新聞秩序/g, "新闻资讯")
    .replace(/食调|食條|十调|十條|十条/g, "10条")
    .replace(/\s+/g, " ")
    .trim();
}

function requestedCount(text) {
  const digit = text.match(/(\d{1,2})\s*(条|條)/);
  if (digit) return clampCount(Number(digit[1]));
  if (/十[条條调]|10[条條调]/.test(text)) return 10;
  if (/五[条條]|5[条條]/.test(text)) return 5;
  if (/三[条條]|3[条條]/.test(text)) return 3;
  return 0;
}

function clampCount(count) {
  if (!Number.isFinite(count)) return 8;
  return Math.max(1, Math.min(10, Math.floor(count)));
}

function buildNewsQueries(text, now) {
  const dateHint = dateQueryHint(text, now);
  const topic = AI_WORD_RE.test(text) || /AI圈/.test(text) ? "AI 人工智能" : cleanFreeQuery(text);
  const queries = [];
  if (/(美国|美國)/.test(text)) queries.push(`${topic} 美国 ${dateHint}`.trim());
  if (/(中国|中國|国内|國內)/.test(text)) queries.push(`${topic} 中国 ${dateHint}`.trim());
  if (/(中美|美国.*中国|中国.*美国)/.test(text)) queries.push(`${topic} 中美 ${dateHint}`.trim());
  queries.push(`${topic} 新闻 ${dateHint}`.trim());
  return [...new Set(queries)].slice(0, 4);
}

function dateQueryHint(text, now) {
  const explicit = text.match(/20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?/);
  if (explicit) return explicit[0].replace(/\s+/g, "");
  if (/(今天|今日|最新|刚刚|最近)/.test(text)) {
    return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  }
  return "";
}

function cleanFreeQuery(text) {
  return text
    .replace(/(帮我|幫我|请|請|给我|給我|查|查询|查詢|总结|總結|梳理|返回|重点|重點|看看|看|新闻|新聞|资讯|資訊|秩序|快讯|快訊|热点|熱點|动态|動態|热门|熱門|最热|最熱|条|條|前后|前後|尽量|盡量|发生|發生|的)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "科技";
}

async function fetchNewsItems(query, fetchImpl) {
  const urls = [
    `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&mkt=zh-CN`,
    ...AI_NEWS_FEEDS
  ];
  const settled = await Promise.allSettled(urls.map((url) => fetchFeedItems(url, fetchImpl)));
  return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

async function fetchFeedItems(url, fetchImpl) {
  const response = await fetchWithTimeout(fetchImpl, url, 8_000);
  if (!response?.ok) throw new Error(`news request failed: ${response?.status || "unknown"}`);
  const xml = await response.text();
  return parseFeedItems(xml);
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 feishu-codex-bridge"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

export function parseRssItems(xml) {
  const items = [];
  const channelSource = decodeXml(readTag(xml, "title"));
  const matches = String(xml || "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi);
  for (const match of matches) {
    const body = match[1];
    const title = decodeXml(readTag(body, "title"));
    const link = decodeXml(readTag(body, "link"));
    const description = stripHtml(decodeXml(readTag(body, "description")));
    const pubDate = decodeXml(readTag(body, "pubDate"));
    const source = decodeXml(readTag(body, "source")) || sourceFromDescription(description) || channelSource;
    if (title) items.push({ title, link, description, pubDate, source });
  }
  return items;
}

export function parseFeedItems(xml) {
  const rss = parseRssItems(xml);
  const atom = parseAtomEntries(xml);
  return [...rss, ...atom];
}

function parseAtomEntries(xml) {
  const items = [];
  const matches = String(xml || "").matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi);
  for (const match of matches) {
    const body = match[1];
    const title = decodeXml(readTag(body, "title"));
    const link = decodeXml(readAtomLink(body));
    const description = stripHtml(decodeXml(readTag(body, "summary") || readTag(body, "content")));
    const pubDate = decodeXml(readTag(body, "updated") || readTag(body, "published"));
    if (title) items.push({ title, link, description, pubDate, source: "The Verge" });
  }
  return items;
}

function readTag(body, tag) {
  const match = String(body || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim() || "";
}

function readAtomLink(body) {
  return String(body || "").match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1] || "";
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceFromDescription(description) {
  const match = String(description || "").match(/^([^：:]{2,24})[：:]/);
  return match?.[1]?.trim() || "";
}

function formatNewsAnswer(items, text) {
  const headline = AI_WORD_RE.test(text) ? "我查到的 AI 新闻重点：" : "我查到的新闻重点：";
  const lines = [headline];
  for (const [index, item] of items.entries()) {
    const meta = [item.source, formatDate(item.pubDate)].filter(Boolean).join("，");
    lines.push(`${index + 1}. ${item.title}`);
    if (meta) lines.push(`   来源：${meta}`);
    if (item.description) lines.push(`   摘要：${truncate(item.description, 90)}`);
    if (item.link) lines.push(`   链接：${item.link}`);
  }
  return lines.join("\n");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function truncate(value, limit) {
  const text = String(value || "").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
