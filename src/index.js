require('dotenv').config();
const { App } = require('@slack/bolt');
const cron = require('node-cron');
const { isWorkday } = require('./holidays');
const { scanMentions } = require('./scanner');
const { sendSummaryDm } = require('./notifier');

const MY_USER_ID = process.env.MY_SLACK_USER_ID;

if (!MY_USER_ID) {
  console.error('ERROR: MY_SLACK_USER_ID が .env に設定されていません');
  process.exit(1);
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  port: process.env.PORT || 3000,
});

// ─── スキャン実行の共通関数 ──────────────────────────────────
async function runScan(session) {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

  if (!isWorkday(jstNow)) {
    console.log('[cron] ' + jstNow.toLocaleDateString('ja-JP') + ' は休日のためスキップ');
    return;
  }

  console.log('[cron] ' + session + ' スキャン開始: ' + jstNow.toLocaleString('ja-JP'));
  try {
    const unreplied = await scanMentions(app.client, MY_USER_ID, session, now);
    await sendSummaryDm(app.client, MY_USER_ID, unreplied, session);
  } catch (err) {
    console.error('[cron] error:', err);
  }
}

// ─── 朝8:00 スキャン（平日 + 祝日チェックはrunScan内） ──────
cron.schedule('0 8 * * 1-5', function() {
  runScan('morning');
}, { timezone: 'Asia/Tokyo' });

// ─── 夕18:00 スキャン ─────────────────────────────────────
cron.schedule('0 18 * * 1-5', function() {
  runScan('evening');
}, { timezone: 'Asia/Tokyo' });

// ─── /remind-now コマンド（手動テスト用） ────────────────────
app.command('/remind-now', async function(opts) {
  await opts.ack();
  // コマンドを使えるのは自分だけ
  if (opts.command.user_id !== MY_USER_ID) {
    return opts.respond({ text: ':no_entry: このコマンドはボットオーナー専用です。' });
  }
  const session = opts.command.text.trim() === 'morning' ? 'morning' : 'evening';
  await opts.respond({ text: ':mag: ' + session + ' スキャンを手動実行します...' });
  try {
    const unreplied = await scanMentions(app.client, MY_USER_ID, session, new Date());
    await sendSummaryDm(app.client, MY_USER_ID, unreplied, session);
    await opts.respond({ text: ':white_check_mark: 完了: ' + unreplied.length + ' 件' });
  } catch (err) {
    await opts.respond({ text: ':x: エラー: ' + err.message });
  }
});

// ─── ヘルスチェック（Herokuスリープ防止） ─────────────────────
const http = require('http');
http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
  }
}).listen(process.env.HEALTH_PORT || 3001);

// ─── 起動 ─────────────────────────────────────────────────
(async function() {
  await app.start();
  console.log('Personal Reminder Bot 起動 (port:' + (process.env.PORT || 3000) + ')');
  console.log('MY_SLACK_USER_ID: ' + MY_USER_ID);
  console.log('スケジュール: 朝8:00 / 夕18:00 (平日・祝日除く)');
})();
