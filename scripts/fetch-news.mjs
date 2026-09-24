#!/usr/bin/env node
/**
 * 时政热点抓取脚本（GitHub Actions 定时运行）
 * 数据源：免费公开的 RSS（人民网时政 / 中国政府网 / 中新网），无需注册、无需 API Key。
 * 输出：
 *   public/news/today.json   当日 5 条
 *   public/news/archive.json 往期池（供「换一批」）
 * 无当日数据时保留最近可用数据并标注 stale。
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'public/news')

const FEEDS = [
  { name: '人民网·时政', url: 'http://www.people.com.cn/rss/politics.xml' },
  { name: '中国政府网', url: 'https://www.gov.cn/pushinfo/v150203/rss.xml' },
  { name: '中新网·要闻', url: 'https://www.chinanews.com.cn/rss/importnews.xml' },
  { name: '中新网·国内', url: 'https://www.chinanews.com.cn/rss/china.xml' },
  { name: '中新网·社会', url: 'https://www.chinanews.com.cn/rss/society.xml' },
]

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

/** 公考视角：政务/政策/经济社会类强信号词（命中才纳入） */
const STRONG = [
  '政策','国务院','常务会议','中央','总书记','政治局','部署','印发','出台','通知','意见','决定','规划','方案','条例','法规','立法','试点','督查','巡视','纪检','监管','座谈','调研','召开','会议','发布','公开','答复','批复','签署','主席令',
  '改革','发展','推进','实施','开展','加强','提升','建设','现代化','高质量','新质生产力','新发展理念','新格局','转型','提质','增效',
  '经济','GDP','增长','增速','统计','数据','指数','产业','市场','企业','民营','外资','消费','投资','外贸','金融','财政','税收','预算','就业','物价','物流','能源',
  '科技','创新','人工智能','数字','芯片','航天','研发','技术','算力','卫星','实验室','专利','标准',
  '生态','环境','绿色','低碳','双碳','碳','污染','环保','长江','黄河','生物多样性','节能','新能源',
  '乡村','农业','农村','农民','粮食','脱贫','振兴','县域','耕地','种业','三农','灌溉',
  '民生','社保','养老','医疗','医保','教育','住房','治理','安全','应急','公共服务','人口','人才','残疾人','救助',
  '法治','法律','司法','执法','法院','检察','违法','依法','合规',
  '党建','从严治','廉洁','作风','党纪','党规','党支部','主题教育',
  '一带一路','国际合作','全球','多边','命运共同体','外交','访问','会谈','共识',
  '共同富裕','收入','分配','普惠','帮扶','慈善',
  '文化','文明','文物','非遗','文旅','博物馆','公共文化','价值观','宣传思想',
]
/** 弱信号（配合强信号加权，不单独成立） */
const WEAK = [
  '社会','群众','服务','保障','体系','机制','平台','工程','项目','资金','投入','补贴','试点示范','表彰','仪式','大会','活动','报告','白皮书','五年规划',
]
const EXCLUDE = [
  '娱乐','明星','八卦','综艺','电影票房','电视剧','球','赛事','奥运','粉丝','演唱会','直播带货','网红','博主','短视频','自嘲','恋情','离婚','凶杀','车祸','奇闻','宠物','美食','旅游攻略','彩票','星座','天气','涨停','股市','基金','减肥','养生',
]

/** 关键词 → 公考考点 */
const POINT_RULES = [
  ['全面从严治党', ['从严治','纪检','巡视','廉洁','作风','党建','党规','党纪','反腐败','监察']],
  ['政治建设', ['政治','党中央','总书记','中央政治局','党建','治理体系','国家治理','制度']],
  ['经济建设', ['经济','GDP','产业','市场','企业','民营','外资','消费','投资','外贸','金融','财政','税收','物价','就业率','统计']],
  ['文化建设', ['文化','文明','文物','非遗','文艺','出版','文旅','博物馆','社会主义核心价值观','宣传思想']],
  ['社会建设', ['民生','就业','社保','养老','医疗','教育','住房','社会治理','安全','应急','公共服务','人口','人才']],
  ['生态文明', ['生态','环境','绿色','低碳','双碳','碳','污染','环保','长江','黄河','生物多样性','节能']],
  ['乡村振兴', ['乡村','农业','农村','农民','粮食','脱贫','振兴','县域','耕地','种业','三农']],
  ['科技创新', ['科技','创新','人工智能','数字','芯片','航天','研发','技术','算力','卫星','实验室']],
  ['共同富裕', ['共同富裕','收入','分配','普惠','帮扶','弱势','慈善','社保']],
  ['一带一路', ['一带一路','国际合作','全球','出海','中欧','外贸','命运共同体','多边','境外']],
  ['依法治国', ['法治','法律','立法','司法','执法','法院','检察','违法','监管','条例','办法','规定']],
  ['新发展理念', ['新发展理念','新质生产力','新格局','创新协调','绿色','开放','共享','转型升级']],
  ['高质量发展', ['高质量','提质','增效','现代化产业','先进制造','专精特新','品牌','标准']],
]

function todayStr() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/**
 * 按 pubDate 字面日期解析（不换算时区）。
 * 部分源把北京时间标成 GMT，换算后会把当天新闻算成次日，故直接取字面年月日。
 */
function parsePubDate(raw) {
  const s = (raw || '').trim()
  if (!s) return todayStr()
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/)
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()]
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`
  }
  m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/)
  if (m)
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? todayStr() : todayStr()
}

function pick(text, re, def = '') {
  const m = text.match(re)
  return m ? m[1].trim() : def
}

function strip(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function hashId(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return (h >>> 0).toString(36)
}

function matchPoints(text) {
  const scored = []
  for (const [name, kws] of POINT_RULES) {
    let score = 0
    for (const k of kws) if (text.includes(k)) score += k.length >= 3 ? 2 : 1
    if (score > 0) scored.push({ name, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const out = scored.slice(0, 3).map((s) => s.name)
  return out.length ? out : ['政治建设']
}

async function fetchText(url) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20000)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml,text/xml,*/*' },
      signal: ctl.signal,
      redirect: 'follow',
    })
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

function parseFeed(xml, sourceName) {
  const items = []
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || []
  for (const b of blocks) {
    const title = strip(pick(b, /<title>([\s\S]*?)<\/title>/i))
    const link = strip(pick(b, /<link>([\s\S]*?)<\/link>/i))
    const desc = strip(pick(b, /<description>([\s\S]*?)<\/description>/i))
    const pub = strip(pick(b, /<pubDate>([\s\S]*?)<\/pubDate>/i))
    if (!title || !link) continue
    items.push({ title, link, desc, date: parsePubDate(pub), source: sourceName })
  }
  return items
}

/** 国际类关键词（公考时政以国内为主，国际内容降权排后） */
const INTERNATIONAL = [
  '韩国','美国','日本','以色列','乌克兰','俄罗斯','朝鲜','伊朗','欧盟','英国','法国','德国','印度','菲律宾','越南','澳大利亚','加拿大','巴西','联合国','特朗普','拜登','普京','泽连斯基','朝美','美军','五角大楼','北约',
]

/** 时政相关度打分：政务源门槛低，综合资讯源要求更高 */
function relevanceScore(it) {
  const t = `${it.title}${it.desc}`
  for (const bad of EXCLUDE) if (t.includes(bad)) return 0
  let strong = 0
  for (const k of STRONG) if (t.includes(k)) strong++
  let weak = 0
  for (const k of WEAK) if (t.includes(k)) weak++
  if (strong === 0) return 0
  return strong * 2 + weak
}

/** 人民网时政 / 中国政府网 天然是时政源，门槛 2；中新网等综合源门槛 5 */
function isRelevant(it) {
  const s = relevanceScore(it)
  if (!s) return false
  const official = it.source.includes('人民网') || it.source.includes('中国政府网')
  return s >= (official ? 2 : 5)
}

async function main() {
  const today = todayStr()
  console.log('today(Asia/Shanghai):', today)

  const all = []
  for (const f of FEEDS) {
    const xml = await fetchText(f.url)
    if (!xml) {
      console.log('× 抓取失败：', f.name)
      continue
    }
    const items = parseFeed(xml, f.name)
    console.log(`√ ${f.name}: ${items.length} 条`)
    all.push(...items)
  }

  // 过滤 + 去重 + 标注考点
  const seen = new Set()
  const pool = []
  for (const it of all) {
    if (!isRelevant(it)) continue
    const id = hashId(it.link)
    if (seen.has(id)) continue
    seen.add(id)
    const summary = (it.desc || '').slice(0, 120)
    pool.push({
      id,
      title: it.title,
      summary,
      url: it.link,
      source: it.source,
      date: it.date,
      points: matchPoints(`${it.title}${it.desc}`),
    })
  }
  console.log('公考相关：', pool.length)

  const readJSON = (p, fallback) => {
    try {
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback
    } catch {
      return fallback
    }
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const todayPath = resolve(OUT_DIR, 'today.json')
  const archivePath = resolve(OUT_DIR, 'archive.json')

  const prevToday = readJSON(todayPath, null)
  const prevArchive = readJSON(archivePath, { date: today, generatedAt: 0, items: [] })

  // 排序权重：政务源优先、国内优先、相关度高的优先
  const rank = (i) => {
    let s = relevanceScore(i)
    if (i.source.includes('人民网') || i.source.includes('中国政府网')) s += 10
    if (INTERNATIONAL.some((k) => i.title.includes(k))) s -= 8
    return s
  }

  // 今日 5 条（必须是当天）
  let todayItems = pool
    .filter((i) => i.date === today)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 5)
  let stale = false
  let message = ''
  if (todayItems.length === 0) {
    stale = true
    todayItems = (prevToday?.items || []).slice(0, 5)
    message = todayItems.length
      ? `当日源暂无更新，展示 ${prevToday?.date || '最近'} 的可用数据`
      : '当日源暂无数据，请稍后再试'
  }

  const todayData = {
    date: stale ? prevToday?.date || today : today,
    generatedAt: Date.now(),
    stale,
    message,
    items: todayItems,
  }

  // 往期池：排除当天与超过 120 天的旧闻，合并去重，最新在前，上限 300
  const minDate = new Date(Date.now() - 120 * 86400000)
    .toISOString()
    .slice(0, 10)
  const map = new Map()
  for (const it of [
    ...pool.filter((i) => i.date !== today && i.date <= today && i.date >= minDate),
    ...(prevArchive.items || []).filter((i) => i.date <= today && i.date >= minDate),
  ]) {
    if (!map.has(it.id)) map.set(it.id, it)
  }
  const archiveItems = Array.from(map.values())
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 300)

  const archiveData = {
    date: archiveItems[0]?.date || today,
    generatedAt: Date.now(),
    items: archiveItems,
  }

  writeFileSync(todayPath, JSON.stringify(todayData, null, 2), 'utf8')
  writeFileSync(archivePath, JSON.stringify(archiveData, null, 2), 'utf8')
  console.log(`写入 today.json：${todayData.items.length} 条（stale=${stale}）`)
  console.log(`写入 archive.json：${archiveItems.length} 条`)
}

main().catch((e) => {
  console.error('抓取失败：', e)
  process.exit(1)
})
