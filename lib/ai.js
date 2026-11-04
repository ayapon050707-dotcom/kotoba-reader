import OpenAI from 'openai';
import { timingSafeEqual } from 'node:crypto';

const systemPrompt = `你是帮助中国留学生阅读日本社会学和人文科学文献的双语学术阅读助手。始终用中文解释，保留日语原文专业术语（必要时附假名）。严格根据提供的选段与上下文工作，不要把外部知识伪装成文献原意。遇到OCR错误要指出不确定性。区分作者观点、引用观点与自己的补充。语言清楚，不随意长篇发挥。`;
const clean = value => String(value || '').slice(0, 13000);
const validAccess = req => {
  const secret = process.env.KOTOBA_ACCESS_CODE;
  const supplied = req.headers['x-kotoba-code'];
  if (!secret || typeof supplied !== 'string') return false;
  const a = Buffer.from(secret), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
};
export function health(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ready: Boolean(process.env.OPENAI_API_KEY && process.env.KOTOBA_ACCESS_CODE), protected: true });
}
export async function ai(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持 POST' });
  if (!process.env.OPENAI_API_KEY || !process.env.KOTOBA_ACCESS_CODE) return res.status(503).json({ error: '服务器尚未设置 OPENAI_API_KEY 和 KOTOBA_ACCESS_CODE。' });
  if (!validAccess(req)) return res.status(401).json({ error: '访问码错误。请点击右上角 AI 状态设置个人访问码。' });
  if (!req.body || typeof req.body !== 'object' || JSON.stringify(req.body).length > 60000) return res.status(413).json({ error: '请求内容过大。' });
  const { mode, selected, pageText, before, after, question, history } = req.body;
  if (!['selection-translate', 'ask', 'page-translate'].includes(mode)) return res.status(400).json({ error: '不支持的操作' });
  if ([selected, pageText, before, after, question].some(v => v !== undefined && typeof v !== 'string')) return res.status(400).json({ error: '请求格式错误' });
  const prior = Array.isArray(history) ? history.slice(-6).filter(x => ['user', 'assistant'].includes(x?.role) && typeof x?.content === 'string').map(x => ({ role: x.role, content: x.content.slice(0, 2500) })) : [];
  let instruction;
  if (mode === 'selection-translate') instruction = '请对【选中日文】进行结合前后文的准确中文翻译。输出：①自然中文译文；②关键词或语法难点（最多三条）；③在语境中这句话的作用（1-2句）。';
  else if (mode === 'page-translate') instruction = '请尽量完整翻译【本页原文】为准确、易读的简体中文，保持原文段落标题结构。人名、理论概念首次出现时附日语原词；不要概述代替翻译。识别出的明显 OCR 错误请标明不确定处。';
  else instruction = '回答用户对【选中日文】和本页的疑问。先解释文中含义，必要时再补充学术背景，并明确区分文献内容与补充知识。优先启发自主理解。';
  const prompt = `${instruction}\n\n【前一页背景】\n${clean(before).slice(-1200)}\n\n【本页原文】\n${clean(pageText)}\n\n【后一页背景】\n${clean(after).slice(0,1200)}\n\n【选中日文】\n${clean(selected)}\n\n【用户问题】\n${clean(question)}`;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45000, maxRetries: 1 });
    const response = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', temperature: 0.25, messages: [{role:'system',content:systemPrompt}, ...(mode==='ask'?prior:[]), {role:'user',content:prompt}] });
    return res.status(200).json({ text: response.choices[0]?.message?.content || '没有收到回复。' });
  } catch (err) {
    console.error('AI request failed', err.status || '', err.code || '');
    return res.status(502).json({error:err.status===401?'OpenAI API Key 无效，请检查 Vercel 环境变量。':'AI 请求失败，请检查网络、模型和 API 余额。'});
  }
}
