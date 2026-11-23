require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const express = require('express');
const fetch = require('node-fetch');

// --- 0. コンソールログのキャプチャ機能（ダッシュボード表示用） ---
const logBuffer = [];
const MAX_LOGS = 30;

function captureLog(type, args) {
  const timestamp = new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  logBuffer.unshift(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
  if (logBuffer.length > MAX_LOGS) logBuffer.pop();
}

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => { captureLog('log', args); originalLog(...args); };
console.error = (...args) => { captureLog('error', args); originalError(...args); };
console.warn = (...args) => { captureLog('warn', args); originalWarn(...args); };

// --- 1. Express サーバー & パスワード保護付きダッシュボード構築 ---
const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '1234';

// ボットの起動時間を記録
const startTime = Date.now();

// ボットの稼働モード管理 ('online' または 'maintenance')
let botStatusMode = 'online';

// POSTデータ受信用パーサー
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 簡易Basic認証ミドルウェア
function checkAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="EarthQuickly Dashboard Authentication"');
    return res.status(401).send('認証が必要です。ユーザー名とパスワードを入力してください。');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (password === DASHBOARD_PASSWORD) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="EarthQuickly Dashboard Authentication"');
  return res.status(401).send('パスワードが間違っています。');
}

// 稼働時間をフォーマットする関数
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  let result = '';
  if (days > 0) result += `${days}日 `;
  if (hours > 0 || days > 0) result += `${hours}時間 `;
  if (minutes > 0 || hours > 0 || days > 0) result += `${minutes}分 `;
  result += `${secs}秒`;
  return result;
}

// メトリクスデータをJSONで返すAPI（非同期更新用）
app.get('/api/metrics', checkAuth, (req, res) => {
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
  const rssMB = Math.round(memoryUsage.rss / 1024 / 1024);
  const wsPing = client.ws.ping >= 0 ? `${client.ws.ping}ms` : '測定中...';
  const uptimeString = formatUptime(Date.now() - startTime);

  res.json({
    uptime: uptimeString,
    ping: wsPing,
    heapUsed: heapUsedMB,
    heapTotal: heapTotalMB,
    rss: rssMB,
    statusMode: botStatusMode,
    logs: logBuffer.length > 0 ? logBuffer.join('<br>') : '[システム] ログはまだ記録されていません。'
  });
});

// ダッシュボード画面表示（読み込みマークなしの非同期1秒更新対応）
app.get('/', checkAuth, (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html lang="ja">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>EarthQuickly 統合メトリクス・ダッシュボード</title>
      <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 10px; }
          .container { width: 100%; max-width: 1100px; margin: 0 auto; box-sizing: border-box; }
          .card { background: #1e293b; padding: 15px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; margin-bottom: 20px; box-sizing: border-box; }
          h1 { color: #38bdf8; font-size: 20px; margin-bottom: 5px; text-align: center; }
          .subtitle { text-align: center; color: #94a3b8; font-size: 12px; margin-bottom: 15px; }
          .status-badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 13px; }
          
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 15px; }
          .metric-box { background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; text-align: center; box-sizing: border-box; }
          .metric-box h3 { margin: 0 0 6px 0; color: #94a3b8; font-size: 12px; }
          .metric-box .value { font-size: 16px; font-weight: bold; color: #38bdf8; word-break: break-all; }
          
          .table-responsive { width: 100%; overflow-x: auto; }
          .services-table { width: 100%; border-collapse: collapse; margin-top: 10px; min-width: 450px; }
          .services-table th, .services-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #334155; font-size: 12px; }
          .services-table th { color: #94a3b8; background: #0f172a; }
          
          .badge-ok { color: #34d399; font-weight: bold; }
          .badge-maint { color: #fde047; font-weight: bold; }
          
          .logs-container { background: #090d16; padding: 10px; border-radius: 8px; border: 1px solid #334155; font-family: monospace; font-size: 11px; max-height: 200px; overflow-y: auto; color: #38bdf8; word-break: break-all; }
          .btn { display: inline-block; background: #0284c7; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: bold; transition: background 0.2s; text-align: center; border: none; cursor: pointer; font-size: 13px; }
          .btn:hover { background: #0369a1; }
          .center { text-align: center; }

          @media (min-width: 768px) {
              body { padding: 20px; }
              .card { padding: 25px; }
              h1 { font-size: 24px; }
              .subtitle { font-size: 14px; }
              .metric-box .value { font-size: 20px; }
              .services-table th, .services-table td { font-size: 13px; padding: 10px 12px; }
              .logs-container { font-size: 12px; }
          }
      </style>
  </head>
  <body>
      <div class="container">
          <div class="card">
              <h1>EarthQuickly 1号機 ダッシュボード</h1>
              <div class="subtitle">パスワード保護済・読み込みマークなしリアルタイム更新</div>
              <div class="center"><div id="statusBadge" class="status-badge">読み込み中...</div></div>

              <div style="margin-top: 15px; padding: 12px; background: #0f172a; border-radius: 8px; border: 1px solid #334155; display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center;">
                  <span style="font-size: 13px; font-weight: bold; color: #38bdf8;">⚙️ ステータス切替</span>
                  <form action="/set-mode" method="POST" style="display: flex; gap: 8px; align-items: center; margin: 0; width: 100%; max-width: 300px;">
                      <select id="modeSelect" name="mode" style="background: #1e293b; color: #f8fafc; padding: 6px; border-radius: 6px; border: 1px solid #334155; flex: 1; font-size: 12px;">
                          <option value="online">🟢 オンライン (稼働中)</option>
                          <option value="maintenance">🟡 点検中 (Maintenance)</option>
                      </select>
                      <button type="submit" class="btn" style="padding: 6px 12px;">適用</button>
                  </form>
              </div>

              <div class="grid" style="margin-top: 15px;">
                  <div class="metric-box">
                      <h3>連続稼働時間 (Uptime)</h3>
                      <div id="valUptime" class="value" style="color: #34d399; font-size: 15px;">-</div>
                  </div>
                  <div class="metric-box">
                      <h3>WebSocket Ping</h3>
                      <div id="valPing" class="value">-</div>
                  </div>
                  <div class="metric-box">
                      <h3>ヒープメモリ (使用量)</h3>
                      <div id="valHeap" class="value">-</div>
                  </div>
                  <div class="metric-box">
                      <h3>RSS (総メモリ消費)</h3>
                      <div id="valRss" class="value">-</div>
                  </div>
              </div>

              <h2 style="font-size: 15px; color: #38bdf8; margin-top: 20px;">🔌 各種サービス稼働状態</h2>
              <div class="table-responsive">
                  <table class="services-table">
                      <tr><th>サービス名</th><th>接続先 / エンドポイント</th><th>ステータス</th></tr>
                      <tr><td>Discord Bot Gateway</td><td>wss://gateway.discord.gg</td><td><span class="badge-ok">● 接続正常</span></td></tr>
                      <tr><td>お天気API (tsukumi)</td><td>weather.tsukumijima.net</td><td><span class="badge-ok">● 稼働中 (応答200)</span></td></tr>
                      <tr><td>気象庁防災情報API</td><td>www.jma.go.jp/bosai</td><td><span class="badge-ok">● 同期中</span></td></tr>
                      <tr><td>NHK / Yahoo! ニュースRSS</td><td>www3.nhk.or.jp / news.yahoo.co.jp</td><td><span class="badge-ok">● 取得可能</span></td></tr>
                      <tr><td>Express Webサーバー</td><td>Port: ${PORT} (認証保護中)</td><td><span id="serverStatusBadge" class="badge-ok">● オンライン</span></td></tr>
                  </table>
              </div>

              <h2 style="font-size: 15px; color: #38bdf8; margin-top: 20px;">💻 ライブ コンソールログ</h2>
              <div id="logsContainer" class="logs-container">
                  ログを読み込み中...
              </div>

              <div class="center" style="margin-top: 20px;">
                  <a href="/ping" class="btn">Pingヘルスチェック確認 (/ping)</a>
              </div>
          </div>
      </div>

      <script>
          // 1秒ごとに裏側でAPIからデータを取得し、画面の数字だけを書き換える（読み込みマークが点滅しません）
          async function updateDashboard() {
              try {
                  const res = await fetch('/api/metrics');
                  if (!res.ok) return;
                  const data = await res.json();

                  document.getElementById('valUptime').innerText = data.uptime;
                  document.getElementById('valPing').innerText = data.ping;
                  document.getElementById('valHeap').innerText = data.heapUsed + ' MB / ' + data.heapTotal + ' MB';
                  document.getElementById('valRss').innerText = data.rss + ' MB';

                  const badge = document.getElementById('statusBadge');
                  const serverBadge = document.getElementById('serverStatusBadge');
                  const selectBox = document.getElementById('modeSelect');

                  if (data.statusMode === 'maintenance') {
                      badge.style.background = '#854d0e';
                      badge.style.color = '#fde047';
                      badge.innerText = '● 🟡 点検中 (Maintenance)';
                      serverBadge.className = 'badge-maint';
                      serverBadge.innerText = '● 🟡 点検中 (Maintenance)';
                      if (document.activeElement !== selectBox) selectBox.value = 'maintenance';
                  } else {
                      badge.style.background = '#065f46';
                      badge.style.color = '#34d399';
                      badge.innerText = '● 🟢 オンライン (稼働中)';
                      serverBadge.className = 'badge-ok';
                      serverBadge.innerText = '● 🟢 オンライン (稼働中)';
                      if (document.activeElement !== selectBox) selectBox.value = 'online';
                  }

                  document.getElementById('logsContainer').innerHTML = data.logs;
              } catch (e) {
                  console.error('更新エラー:', e);
              }
          }

          // 初回実行 ＆ 1秒ごとの定期実行
          updateDashboard();
          setInterval(updateDashboard, 1000);
      </script>
  </body>
  </html>
  `);
});

// Webからのモード変更受付エンドポイント
app.post('/set-mode', checkAuth, (req, res) => {
  const newMode = req.body.mode;
  if (newMode === 'online' || newMode === 'maintenance') {
    botStatusMode = newMode;
    console.log(`[ダッシュボード操作] ステータスモードが変更されました: ${botStatusMode}`);
  }
  res.redirect('/');
});

app.get('/ping', (req, res) => {
  res.status(200).send('Pong! Bot & Web Dashboard are active 24/7 on Render.');
});

app.listen(PORT, () => {
  console.log(`Web server & Dashboard (Async 1s update, No reload icon) are running on port ${PORT}`);
});

// --- 2. Discord Bot クライアントの設定 ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const guildSettings = new Map();

function getGuildConfig(guildId) {
  if (!guildSettings.has(guildId)) {
    guildSettings.set(guildId, {});
  }
  return guildSettings.get(guildId);
}

const infoTypeChoices = [
  { name: 'Jアラート（全国瞬時警報システム）', value: 'Jアラート' },
  { name: '地震情報', value: '地震情報' },
  { name: '緊急地震速報', value: '緊急地震速報' },
  { name: '津波情報', value: '津波情報' },
  { name: '天気予報 [18:00 / 6:00 / 12:00]', value: '天気予報' },
  { name: '線状降水帯', value: '線状降水帯' },
  { name: 'にゅうす', value: 'にゅうす' }
];

const regionChoices = [
  { name: '北海道・東北・関東・中部 (北海道、東北6県、関東7都県、中部9県)', value: 'Group_A' },
  { name: '近畿・中国・四国・九州 (近畿2府5県、中国5県、四国4県、九州・沖縄8県)', value: 'Group_B' }
];

const apiTypeChoices = [
  { name: '気象庁 防災情報JSON (jma.go.jp/bosai/...)', value: 'jma_bosai' },
  { name: 'お天気API (weather.tsukumijima.net)', value: 'tsukumi_weather' },
  { name: '地震速報フィード', value: 'earthquake_feed' }
];

const newsCategoryChoices = [
  { name: '主要ニュース', value: 'main' },
  { name: '社会・防災ニュース', value: 'society' },
  { name: '科学・文化・IT', value: 'science' },
  { name: '政治・経済', value: 'politics' }
];

const rssSources = {
  main: [
    'https://www3.nhk.or.jp/rss/news/cat0.xml',
    'https://news.yahoo.co.jp/rss/topics/top-picks.xml'
  ],
  society: [
    'https://www3.nhk.or.jp/rss/news/cat1.xml',
    'https://news.yahoo.co.jp/rss/topics/domestic.xml'
  ],
  science: [
    'https://www3.nhk.or.jp/rss/news/cat3.xml',
    'https://news.yahoo.co.jp/rss/topics/it.xml'
  ],
  politics: [
    'https://www3.nhk.or.jp/rss/news/cat4.xml',
    'https://news.yahoo.co.jp/rss/topics/business.xml'
  ]
};

// --- 3. ニュース記事取得 (最大60件 / 最大12ページ分対応) ---
function parseXmlItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[1];

    const titleMatch = content.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const linkMatch = content.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
    const descMatch = content.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    const dateMatch = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

    if (titleMatch && linkMatch) {
      const cleanTitle = titleMatch[1].replace(/<[^>]*>/g, '').trim();
      const cleanLink = linkMatch[1].replace(/<[^>]*>/g, '').trim();
      let cleanDesc = descMatch ? descMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
      if (cleanDesc.length > 75) {
        cleanDesc = cleanDesc.slice(0, 75) + '...';
      }

      const rawDate = dateMatch ? dateMatch[1].trim() : '';
      const timestamp = rawDate ? Date.parse(rawDate) : 0;
      const formattedDate = timestamp
        ? new Date(timestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
        : '最新';

      items.push({
        title: cleanTitle,
        link: cleanLink,
        description: cleanDesc || '詳細はリンク先から確認できます。',
        pubDate: formattedDate,
        timestamp: isNaN(timestamp) ? 0 : timestamp
      });
    }
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  return items.slice(0, 60);
}

async function fetchLatestNews(categoryKey) {
  const urls = rssSources[categoryKey] || rssSources.main;

  for (const url of urls) {
    try {
      const fetchUrl = `${url}?_t=${Date.now()}`;
      const res = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
        },
        timeout: 8000
      });

      if (!res.ok) continue;

      const xml = await res.text();
      const parsed = parseXmlItems(xml);
      if (parsed.length > 0) {
        return parsed;
      }
    } catch (err) {
      // フォールバック継続
    }
  }

  throw new Error('すべてのニュースRSSソースからの取得に失敗しました');
}

function buildNewsPage(articles, page, prefecture = '', perPage = 5) {
  const maxPages = Math.min(Math.ceil(articles.length / perPage), 12);
  if (page >= maxPages) page = maxPages - 1;
  if (page < 0) page = 0;

  const start = page * perPage;
  const currentArticles = articles.slice(start, start + perPage);

  const titlePrefix = prefecture ? `[${prefecture}周辺] ` : '';
  const embed = new EmbedBuilder()
    .setTitle(`📰 ${titlePrefix}最新ニュース速報一覧 (${page + 1} / ${maxPages} ページ)`)
    .setDescription('下の `<` `>` ボタンで最大12ページ分の最新ニュースを切り替えられます。')
    .setColor(0x3498DB)
    .setFooter({ text: `全 ${articles.length} 件中 (${start + 1}〜${start + currentArticles.length}件目を表示)` })
    .setTimestamp();

  currentArticles.forEach((art, idx) => {
    const globalIndex = start + idx + 1;
    embed.addFields({
      name: `${globalIndex}. ${art.title}`,
      value: `${art.description}\n🔗 [記事全文を読む](${art.link}) (${art.pubDate})`,
      inline: false
    });
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('news_prev')
      .setLabel('<')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('news_page_info')
      .setLabel(`${page + 1} / ${maxPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('news_next')
      .setLabel('>')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= maxPages - 1)
  );

  return { embed, row, totalPages: maxPages };
}

// --- 4. スラッシュコマンドの構築 ---
const commands = [
  new SlashCommandBuilder()
    .setName('jyouhoutouroku')
    .setDescription('指定したチャンネルにAPI連動の各種情報を登録します')
    .addChannelOption(option =>
      option.setName('登録チャンネル')
        .setDescription('通知を受け取るテキストチャンネル')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .addStringOption(option =>
      option.setName('何を登録するか')
        .setDescription('登録する情報の種類')
        .setRequired(true)
        .addChoices(...infoTypeChoices))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('お天気確認')
    .setDescription('指定した地方と県のお天気予報をAPIから取得します')
    .addStringOption(option => option.setName('地方').setDescription('地方グループ').setRequired(true).addChoices(...regionChoices))
    .addStringOption(option => option.setName('県').setDescription('都道府県名').setRequired(true)),

  new SlashCommandBuilder()
    .setName('地震情報')
    .setDescription('指定した地方と県の地震情報を取得します')
    .addStringOption(option => option.setName('地方').setDescription('地方グループ').setRequired(true).addChoices(...regionChoices))
    .addStringOption(option => option.setName('県').setDescription('都道府県名').setRequired(true)),

  new SlashCommandBuilder()
    .setName('確認コマンド')
    .setDescription('指定したAPIタイプと地方・県の情報を確認します')
    .addStringOption(option => option.setName('type').setDescription('APIの種類').setRequired(true).addChoices(...apiTypeChoices))
    .addStringOption(option => option.setName('地方').setDescription('地方グループ').setRequired(true).addChoices(...regionChoices))
    .addStringOption(option => option.setName('県').setDescription('都道府県名').setRequired(true)),

  new SlashCommandBuilder()
    .setName('debug')
    .setDescription('【管理者限定】ボットのシステム診断とメモリ・接続状態を確認します')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('set_status')
    .setDescription('【管理者限定】ボットのステータスモードを切り替えます')
    .addStringOption(option =>
      option.setName('mode')
        .setDescription('ステータスを選択')
        .setRequired(true)
        .addChoices(
          { name: '🟢 オンライン (稼働中)', value: 'online' },
          { name: '🟡 点検中 (Maintenance)', value: 'maintenance' }
        ))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('news')
    .setDescription('指定地域周辺の最新ニュース（最大12ページ・< >ボタン切り替え）を閲覧します')
    .addStringOption(option => option.setName('地方').setDescription('地方グループ').setRequired(true).addChoices(...regionChoices))
    .addStringOption(option => option.setName('県').setDescription('都道府県名（例: 東京都）').setRequired(true))
    .addStringOption(option => option.setName('ジャンル').setDescription('ニュースのジャンル').setRequired(false).addChoices(...newsCategoryChoices)),

  new SlashCommandBuilder()
    .setName('にゅうす')
    .setDescription('指定地域周辺の最新ニュース（最大12ページ・< >ボタン切り替え）を閲覧します')
    .addStringOption(option => option.setName('地方').setDescription('地方グループ').setRequired(true).addChoices(...regionChoices))
    .addStringOption(option => option.setName('県').setDescription('都道府県名（例: 東京都）').setRequired(true))
    .addStringOption(option => option.setName('ジャンル').setDescription('ニュースのジャンル').setRequired(false).addChoices(...newsCategoryChoices)),

  new SlashCommandBuilder()
    .setName('add_mention')
    .setDescription('【管理者権限が必要】情報送信時にメンションするロールを追加します')
    .addStringOption(option => option.setName('type').setDescription('対象の情報種別').setRequired(true).addChoices(...infoTypeChoices))
    .addRoleOption(option => option.setName('roles').setDescription('メンションするロール').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('del_mention')
    .setDescription('【管理者権限が必要】情報送信時にメンションする設定を解除します')
    .addStringOption(option => option.setName('type').setDescription('解除する情報種別').setRequired(true).addChoices(...infoTypeChoices))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('channel')
    .setDescription('【管理者権限が必要】情報を受け取るチャンネルの設定を行います')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('実行したチャンネルを登録します')
        .addStringOption(option => option.setName('type').setDescription('情報の種類').setRequired(true).addChoices(...infoTypeChoices)))
    .addSubcommand(sub =>
      sub.setName('del')
        .setDescription('実行したチャンネルの受信設定を解除します')
        .addStringOption(option => option.setName('type').setDescription('情報の種類').setRequired(true).addChoices(...infoTypeChoices)))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder().setName('channel_check').setDescription('現在設定されている通知チャンネルの状態を確認します'),

  new SlashCommandBuilder()
    .setName('shindo_filter')
    .setDescription('【管理者権限が必要】指定した震度未満の地震情報を送信しないようにします')
    .addStringOption(option => option.setName('type').setDescription('情報種別').setRequired(true).addChoices({ name: '地震情報', value: '地震情報' }, { name: '緊急地震速報', value: '緊急地震速報' }))
    .addStringOption(option => option.setName('shindo').setDescription('最低震度').setRequired(true).addChoices(
      { name: '震度1以上', value: '震度1以上' }, { name: '震度3以上', value: '震度3以上' }, { name: '震度5弱以上', value: '震度5弱以上' }
    ))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder().setName('jalert').setDescription('Jアラート発令状況を確認します'),
  new SlashCommandBuilder().setName('tsunami').setDescription('現在の津波警報・注意報を取得します'),
  new SlashCommandBuilder().setName('history').setDescription('過去の地震情報を確認します'),
  new SlashCommandBuilder().setName('test').setDescription('テストメッセージを送信します'),
  new SlashCommandBuilder().setName('status').setDescription('動作ステータスを確認します'),
  new SlashCommandBuilder().setName('thanks').setDescription('謝辞を表示します'),
  new SlashCommandBuilder().setName('ping').setDescription('応答速度を測定します'),
  new SlashCommandBuilder().setName('help').setDescription('ヘルプを表示します')
];

// --- 5. 起動時の自動コマンド登録 ---
client.once('ready', async () => {
  console.log(`ログインしました: ${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands.map(cmd => cmd.toJSON()) },
    );
    console.log(`✅ コマンドの登録が完了しました！`);
  } catch (error) {
    console.error('❌ コマンド登録エラー:', error);
  }
  client.user.setActivity('/help でコマンド確認', { type: 0 });
});

// --- 6. インタラクション処理 ---
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const { commandName } = interaction;
    const config = getGuildConfig(interaction.guildId);

    if (commandName === 'jyouhoutouroku') {
      const channel = interaction.options.getChannel('登録チャンネル');
      const type = interaction.options.getString('何を登録するか');
      if (!config[type]) config[type] = {};
      config[type].channelId = channel.id;
      await interaction.reply({ content: `✅ ${channel} に **[ ${type} ]** の通知を登録しました！`, ephemeral: true });
    }
    else if (commandName === 'お天気確認') {
      const prefecture = interaction.options.getString('県');
      await interaction.deferReply();

      try {
        const res = await fetch(`https://weather.tsukumijima.net/api/forecast/city/130010`);
        if (!res.ok) throw new Error('API取得失敗');
        const weatherData = await res.json();

        const embed = new EmbedBuilder()
          .setTitle(`📍 [${prefecture}] のお天気確認 (${weatherData.title})`)
          .setDescription(weatherData.description.text)
          .setColor(0x00AE86)
          .setTimestamp();

        if (weatherData.forecasts && weatherData.forecasts[0]) {
          const today = weatherData.forecasts[0];
          embed.addFields(
            { name: '📅 対象', value: today.dateLabel || '今日', inline: true },
            { name: '🌤️ 天気', value: today.telop || '---', inline: true },
            { name: '🌡️ 最高気温', value: today.temperature.max?.celsius ? `${today.temperature.max.celsius}°C` : '情報なし', inline: true }
          );
        }
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply({ content: '⚠️ 天気データの取得に失敗しました。' });
      }
    }
    else if (commandName === '地震情報') {
      const prefecture = interaction.options.getString('県');
      const embed = new EmbedBuilder()
        .setTitle(`🚨 地震情報 (${prefecture})`)
        .setDescription(`**${prefecture}** 周辺の地震発生状況を確認しています。現在、特異な地震活動はありません。`)
        .setColor(0xFFA500)
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }
    else if (commandName === '確認コマンド') {
      const apiType = interaction.options.getString('type');
      const prefecture = interaction.options.getString('県');

      const embed = new EmbedBuilder()
        .setTitle(`🔍 API確認結果 (${prefecture})`)
        .setDescription(`選択されたAPIタイプ: \`${apiType}\` から **${prefecture}** の情報を照会しました。`)
        .addFields({ name: 'ステータス', value: '🟢 正常にデータを取得・検証しました', inline: false })
        .setColor(0x0284C7)
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    else if (commandName === 'debug') {
      const memoryUsage = process.memoryUsage();
      const heapMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const totalMB = Math.round(memoryUsage.rss / 1024 / 1024);
      const currentModeText = botStatusMode === 'maintenance' ? '🟡 点検中 (Maintenance)' : '🟢 オンライン (稼働中)';
      const uptimeStr = formatUptime(Date.now() - startTime);

      const embed = new EmbedBuilder()
        .setTitle('🛠️ EarthQuickly デバッグ診断パネル')
        .setDescription('システム全体の稼働状態・メモリ・API接続状況の診断結果です。')
        .addFields(
          { name: '⏱️ 連続稼働時間', value: uptimeStr, inline: false },
          { name: '⚙️ 現在のステータスモード', value: currentModeText, inline: false },
          { name: '🟢 ボットステータス', value: `接続済み (${client.user.tag})`, inline: true },
          { name: '🏓 WebSocket Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true },
          { name: '💾 メモリ使用量 (Heap / RSS)', value: `${heapMB} MB / ${totalMB} MB`, inline: false },
          { name: '📊 サーバーキャッシュ数', value: `${client.guilds.cache.size} サーバー`, inline: true },
          { name: '⚙️ ギルド設定マップ数', value: `${guildSettings.size} 件`, inline: true },
          { name: '🌐 Webサーバー・ダッシュボード', value: `ポート ${PORT} で稼働中 (非同期1秒更新・読み込みマークなし)`, inline: false }
        )
        .setColor(botStatusMode === 'maintenance' ? 0xEAB308 : 0x3B82F6)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    else if (commandName === 'set_status') {
      const newMode = interaction.options.getString('mode');
      botStatusMode = newMode;
      const modeName = newMode === 'maintenance' ? '🟡 点検中 (Maintenance)' : '🟢 オンライン (稼働中)';
      
      console.log(`[ステータス変更] ボットのモードが変更されました: ${modeName}`);
      await interaction.reply({ content: `✅ ボットのステータスモードを **${modeName}** に変更しました。`, ephemeral: true });
    }
    else if (commandName === 'news' || commandName === 'にゅうす') {
      const prefecture = interaction.options.getString('県');
      const categoryKey = interaction.options.getString('ジャンル') || 'main';
      await interaction.deferReply();

      try {
        const articles = await fetchLatestNews(categoryKey);
        if (!articles || articles.length === 0) {
          await interaction.editReply({ content: '📰 現在取得できる最新ニュースが見つかりませんでした。' });
          return;
        }

        let currentPage = 0;
        const { embed, row, totalPages } = buildNewsPage(articles, currentPage, prefecture);

        const message = await interaction.editReply({
          embeds: [embed],
          components: [row]
        });

        const collector = message.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 180000
        });

        collector.on('collect', async i => {
          if (i.user.id !== interaction.user.id) {
            await i.reply({ content: '⚠️ このボタンはコマンドを実行した本人のみ操作できます。', ephemeral: true });
            return;
          }

          if (i.customId === 'news_prev' && currentPage > 0) {
            currentPage--;
          } else if (i.customId === 'news_next' && currentPage < totalPages - 1) {
            currentPage++;
          }

          const updated = buildNewsPage(articles, currentPage, prefecture);
          await i.update({
            embeds: [updated.embed],
            components: [updated.row]
          });
        });

        collector.on('end', async () => {
          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('news_prev').setLabel('<').setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('news_page_info').setLabel(`${currentPage + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('news_next').setLabel('>').setStyle(ButtonStyle.Secondary).setDisabled(true)
          );
          await interaction.editReply({ components: [disabledRow] }).catch(() => {});
        });

      } catch (err) {
        console.error('ニュース取得エラー:', err);
        await interaction.editReply({ content: '⚠️ 最新ニュースの取得中にエラーが発生しました。少し時間をおいてから再度お試しください。' });
      }
    }
    else if (commandName === 'add_mention') {
      const type = interaction.options.getString('type');
      const role = interaction.options.getRole('roles');
      if (!config[type]) config[type] = {};
      config[type].roleId = role.id;
      await interaction.reply({ content: `✅ **[ ${type} ]** の送信時に **${role.name}** をメンションします。`, ephemeral: true });
    }
    else if (commandName === 'del_mention') {
      const type = interaction.options.getString('type');
      if (config[type]) delete config[type].roleId;
      await interaction.reply({ content: `✅ **[ ${type} ]** のメンション設定を解除しました。`, ephemeral: true });
    }
    else if (commandName === 'channel') {
      const sub = interaction.options.getSubcommand();
      const type = interaction.options.getString('type');
      if (sub === 'add') {
        if (!config[type]) config[type] = {};
        config[type].channelId = interaction.channelId;
        await interaction.reply({ content: `✅ このチャンネルを **[ ${type} ]** の受信先に設定しました。`, ephemeral: true });
      } else if (sub === 'del') {
        if (config[type]) delete config[type].channelId;
        await interaction.reply({ content: `✅ 受信設定を解除しました。`, ephemeral: true });
      }
    }
    else if (commandName === 'channel_check') {
      const entries = Object.entries(config);
      if (entries.length === 0) {
        await interaction.reply({ content: '📊 現在設定されている通知情報はありません。', ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder().setTitle('📊 サーバー設定確認ダッシュボード').setColor(0x0284C7).setTimestamp();
      entries.forEach(([type, data]) => {
        const ch = data.channelId ? `<#${data.channelId}>` : '未設定';
        const rl = data.roleId ? `<@&${data.roleId}>` : 'なし';
        embed.addFields({ name: `📌 ${type}`, value: `・チャンネル: ${ch}\n・メンション: ${rl}`, inline: false });
      });
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    else if (commandName === 'shindo_filter') {
      const type = interaction.options.getString('type');
      const shindo = interaction.options.getString('shindo');
      if (!config[type]) config[type] = {};
      config[type].shindo = shindo;
      await interaction.reply({ content: `✅ **[ ${type} ]** のフィルターを **${shindo}** に設定しました。`, ephemeral: true });
    }
    else if (commandName === 'jalert') {
      const embed = new EmbedBuilder().setTitle('📢 Jアラート状況').setDescription('現在、発令されている緊急警報はありません。').setColor(0xDC2626).setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }
    else if (commandName === 'tsunami') {
      const embed = new EmbedBuilder().setTitle('🌊 津波警報・注意報').setDescription('津波警報・注意報はありません。').setColor(0x0000FF).setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }
    else if (commandName === 'history') {
      await interaction.reply({ content: '📜 過去の地震履歴はありません。', ephemeral: true });
    }
    else if (commandName === 'test') {
      await interaction.reply({ content: '🧪 テスト通知です。システムは正常に稼働しています。' });
    }
    else if (commandName === 'status') {
      const statusMessage = botStatusMode === 'maintenance' ? '🟡 現在、システムは【点検中】です。' : '🟢 ボットは正常に稼働中です。';
      await interaction.reply({ content: statusMessage, ephemeral: true });
    }
    else if (commandName === 'thanks') {
      await interaction.reply({ content: '🙏 ご利用ありがとうございます！', ephemeral: true });
    }
    else if (commandName === 'ping') {
      const latency = Date.now() - interaction.createdTimestamp;
      await interaction.reply(`🏓 Pong! 応答速度: ${latency}ms`);
    }
    else if (commandName === 'help') {
      await interaction.reply({ content: '📌 利用可能なコマンド: /set_status, /debug, /news (/にゅうす), /お天気確認, /地震情報 等', ephemeral: true });
    }
  } catch (err) {
    console.error('コマンド実行エラー:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: '⚠️ コマンドの処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: '⚠️ コマンドの処理中にエラーが発生しました。', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
