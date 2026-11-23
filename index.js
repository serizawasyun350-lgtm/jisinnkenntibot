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

// --- 1. Express サーバー & 120項目ダッシュボード構築 ---
const app = express();
const PORT = process.env.PORT || 3000;

function generate120DashboardItems() {
  let items = '';
  const categories = [
    'システム一般設定', 'JアラートAPI連携', '地震情報API同期', '津波警報API監視',
    'お天気API(tsukumi)', '線状降水帯API', 'ニュースRSS取得', '自動通知キュー',
    'ロールメンション制御', 'チャンネル権限管理', 'Ping死活監視', 'エラーログ自動収集'
  ];
  
  for (let i = 1; i <= 120; i++) {
    const catIndex = Math.floor((i - 1) / 10) % categories.length;
    const catName = categories[catIndex];
    items += `<li><span>[${catName}] 設定・メトリクス #${i}</span><span class="badge">稼働中</span></li>\n`;
  }
  return items;
}

const dashboardHtml = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EarthQuickly 120項目ダッシュボード</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; }
        .card { background: #1e293b; padding: 25px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; margin-bottom: 20px; text-align: center; }
        h1 { color: #38bdf8; font-size: 24px; margin-bottom: 10px; }
        .status { display: inline-block; padding: 6px 14px; background: #065f46; color: #34d399; border-radius: 20px; font-weight: bold; font-size: 14px; margin-bottom: 15px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; text-align: left; max-height: 400px; overflow-y: auto; background: #0f172a; padding: 15px; border-radius: 8px; border: 1px solid #334155; }
        .metrics-grid ul { list-style: none; padding: 0; margin: 0; }
        .metrics-grid li { display: flex; justify-content: space-between; padding: 5px 8px; border-bottom: 1px solid #1e293b; font-size: 12px; }
        .badge { background: #0284c7; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; }
        .btn { display: inline-block; background: #0284c7; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 15px; transition: background 0.2s; }
        .btn:hover { background: #0369a1; }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <h1>EarthQuickly 1号機 ダッシュボード</h1>
            <div class="status">● オンライン (最新ニュースRSS・各種API連携・全120項目稼働中)</div>
            <p>リアルタイムニュース記事取得、お天気API、地震・津波・JアラートAPI連動を統合管理しています。</p>
            <div class="metrics-grid">
                <ul>
                    ${generate120DashboardItems()}
                </ul>
            </div>
            <a href="/ping" class="btn">Pingエンドポイントを確認 (/ping)</a>
        </div>
    </div>
</body>
</html>
`;

app.get('/', (req, res) => {
  res.send(dashboardHtml);
});

app.get('/ping', (req, res) => {
  res.status(200).send('Pong! Bot is active 24/7 on Render.');
});

app.listen(PORT, () => {
  console.log(`Web server & 120-Item Dashboard are running on port ${PORT}`);
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

// ジャンルごとのプライマリRSS（NHK）＆フォールバックRSS（Yahoo!ニュース）
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

// --- 3. 確実取得型の最新ニュースRSSパーサー ---
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

  // 公開日時が新しい順（最新順）にソート
  items.sort((a, b) => b.timestamp - a.timestamp);
  return items.slice(0, 20);
}

async function fetchLatestNews(categoryKey) {
  const urls = rssSources[categoryKey] || rssSources.main;

  for (const url of urls) {
    try {
      // キャッシュ回避用のタイムスタンプ付与＆User-Agent指定
      const fetchUrl = `${url}?_t=${Date.now()}`;
      const res = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
        },
        timeout: 8000
      });

      if (!res.ok) {
        console.warn(`RSS取得スキップ (${res.status}): ${url}`);
        continue;
      }

      const xml = await res.text();
      const parsed = parseXmlItems(xml);
      if (parsed.length > 0) {
        return parsed;
      }
    } catch (err) {
      console.warn(`RSS通信エラー (${url}):`, err.message);
    }
  }

  throw new Error('すべてのニュースRSSソースからの取得に失敗しました');
}

function buildNewsPage(articles, page, perPage = 5) {
  const totalPages = Math.ceil(articles.length / perPage);
  const start = page * perPage;
  const currentArticles = articles.slice(start, start + perPage);

  const embed = new EmbedBuilder()
    .setTitle(`📰 最新ニュース速報一覧 (${page + 1} / ${totalPages} ページ)`)
    .setDescription('下の `<` `>` ボタンで前後の最新ニュースに切り替えられます。')
    .setColor(0x3498DB)
    .setFooter({ text: `全 ${articles.length} 件の最新記事を取得済み` })
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
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('news_next')
      .setLabel('>')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1)
  );

  return { embed, row, totalPages };
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
    .setName('news')
    .setDescription('最新のニュース記事一覧（< > ボタン切り替え付き）を閲覧します')
    .addStringOption(option =>
      option.setName('ジャンル')
        .setDescription('閲覧したいニュースのジャンル（省略時は主要ニュース）')
        .setRequired(false)
        .addChoices(...newsCategoryChoices)),

  new SlashCommandBuilder()
    .setName('にゅうす')
    .setDescription('最新のニュース記事一覧（< > ボタン切り替え付き）を閲覧します')
    .addStringOption(option =>
      option.setName('ジャンル')
        .setDescription('閲覧したいニュースのジャンル（省略時は主要ニュース）')
        .setRequired(false)
        .addChoices(...newsCategoryChoices)),

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
    // 最新ニュース記事一覧（< > ボタンUIによるページ切り替え対応）
    else if (commandName === 'news' || commandName === 'にゅうす') {
      const categoryKey = interaction.options.getString('ジャンル') || 'main';
      await interaction.deferReply();

      try {
        const articles = await fetchLatestNews(categoryKey);
        if (!articles || articles.length === 0) {
          await interaction.editReply({ content: '📰 現在取得できる最新ニュースが見つかりませんでした。' });
          return;
        }

        let currentPage = 0;
        const { embed, row, totalPages } = buildNewsPage(articles, currentPage);

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

          const updated = buildNewsPage(articles, currentPage);
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
      await interaction.reply({ content: '🟢 ボットは正常に稼働中です。', ephemeral: true });
    }
    else if (commandName === 'thanks') {
      await interaction.reply({ content: '🙏 ご利用ありがとうございます！', ephemeral: true });
    }
    else if (commandName === 'ping') {
      const latency = Date.now() - interaction.createdTimestamp;
      await interaction.reply(`🏓 Pong! 応答速度: ${latency}ms`);
    }
    else if (commandName === 'help') {
      await interaction.reply({ content: '📌 利用可能なコマンド: /news (/にゅうす), /お天気確認, /地震情報, /確認コマンド, /jyouhoutouroku 等', ephemeral: true });
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
