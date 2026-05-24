import test from "node:test";
import assert from "node:assert/strict";
import {
  isNewsQuestion,
  isNewsSourceFollowUp,
  maybeAnswerNewsQuestion,
  normalizeNewsText,
  parseRssItems
} from "../src/quick/news.js";

const RSS = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title><![CDATA[中国 AI 公司发布新模型]]></title>
    <link>https://example.com/china-ai</link>
    <description><![CDATA[来源：新模型面向企业场景。]]></description>
    <pubDate>Sun, 24 May 2026 08:00:00 GMT</pubDate>
    <source>示例新闻</source>
  </item>
  <item>
    <title>美国 AI 芯片公司扩大产能</title>
    <link>https://example.com/us-ai</link>
    <description>芯片供应链继续升温。</description>
    <pubDate>Sun, 24 May 2026 09:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

test("detects news requests from audio transcripts", () => {
  const text = normalizeNewsText("音频转写：帮我总结2026年5月24日AIA圈的10条新闻资讯重点看美国和中国");
  assert.match(text, /AI圈/);
  assert.equal(isNewsQuestion(text), true);

  const traditional = normalizeNewsText("音频转写：幫我總結2026年5月24日AHA的10條新聞資訊重點看美國和中國");
  assert.match(traditional, /AI的/);
  assert.equal(isNewsQuestion(traditional), true);

  const noisy = normalizeNewsText("音频转写：很好你在帮我把2026年5月24日发生的夜夜圈的新闻秩序给我食调最热的最热门的");
  assert.match(noisy, /AI圈/);
  assert.match(noisy, /新闻资讯/);
  assert.equal(isNewsQuestion(noisy), true);

  const sourceRequest = normalizeNewsText("音频转写：把10条翻一层中纹然后再附上来远");
  assert.match(sourceRequest, /中文/);
  assert.match(sourceRequest, /来源/);
  assert.equal(isNewsSourceFollowUp(sourceRequest), true);
});

test("parses rss news items", () => {
  const items = parseRssItems(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "中国 AI 公司发布新模型");
  assert.equal(items[0].source, "示例新闻");
});

test("answers news requests from rss search", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return { ok: true, text: async () => RSS };
  };

  const answer = await maybeAnswerNewsQuestion({
    prompt: "音频转写：帮我总结2026年5月24日AIA圈的10条新闻资讯重点看美国和中国",
    fetchImpl,
    now: new Date("2026-05-24T12:00:00Z")
  });

  assert.match(answer, /我查到的 AI 新闻重点/);
  assert.match(answer, /中国 AI 公司发布新模型/);
  assert.match(answer, /美国 AI 芯片公司扩大产能/);
  assert.ok(urls.some((url) => decodeURIComponent(url).includes("美国")));
  assert.ok(urls.some((url) => decodeURIComponent(url).includes("中国")));
});

test("answers noisy transcribed news requests", async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => RSS });
  const answer = await maybeAnswerNewsQuestion({
    prompt: "音频转写：很好你在帮我把2026年5月24日发生的夜夜圈的新闻秩序给我食调最热的最热门的",
    fetchImpl,
    now: new Date("2026-05-24T12:00:00Z")
  });

  assert.match(answer, /我查到的 AI 新闻重点/);
  assert.match(answer, /中国 AI 公司发布新模型/);
});

test("uses previous news prompt for source follow ups", async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => RSS });
  const answer = await maybeAnswerNewsQuestion({
    prompt: "音频转写：你為什麼沒有附上新聞的來源呢?我讓你附上來源呀",
    previousPrompt: "把昨天發生的AI新聞資訊給我10條好嗎?",
    fetchImpl,
    now: new Date("2026-05-24T12:00:00Z")
  });

  assert.match(answer, /来源/);
  assert.match(answer, /链接/);
  assert.match(answer, /中国 AI 公司发布新模型/);
});
