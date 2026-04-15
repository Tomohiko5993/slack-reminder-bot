const { WebClient } = require('@slack/web-api');
const { getScanRange } = require('./holidays');

/**
 * search.messages API で自分への直接メンションを検索する
 */
async function searchMentions(userToken, myUserId, oldest, latest) {
  const userClient = new WebClient(userToken);
  const query = `<@${myUserId}>`;
  const oldestDate = new Date(oldest * 1000).toISOString().split('T')[0];
  const latestDate = new Date(latest * 1000).toISOString().split('T')[0];

  let messages = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await userClient.search.messages({
      query: `${query} after:${oldestDate} before:${latestDate}`,
      count: 100,
      page,
    });
    const matches = (res.messages && res.messages.matches) || [];
    messages = messages.concat(matches);
    totalPages = (res.messages && res.messages.paging && res.messages.paging.pages) || 1;
    page++;
  } while (page <= totalPages);

  // after:/before: は日付単位なので、Unix秒で時間まで絞り込む
  return messages.filter(m => {
    const ts = parseFloat(m.ts);
    return ts >= oldest && ts <= latest;
  });
}

/**
 * search.messages API で自分宛DMを検索する
 */
async function searchDMs(userToken, oldest, latest) {
  const userClient = new WebClient(userToken);
  const oldestDate = new Date(oldest * 1000).toISOString().split('T')[0];
  const latestDate = new Date(latest * 1000).toISOString().split('T')[0];

  let messages = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await userClient.search.messages({
      query: `in:@me after:${oldestDate} before:${latestDate}`,
      count: 100,
      page,
    });
    const matches = (res.messages && res.messages.matches) || [];
    messages = messages.concat(matches);
    totalPages = (res.messages && res.messages.paging && res.messages.paging.pages) || 1;
    page++;
  } while (page <= totalPages);

  // 時間まで絞り込む
  return messages.filter(m => {
    const ts = parseFloat(m.ts);
    return ts >= oldest && ts <= latest;
  });
}

/**
 * search.messages の結果から自分が返信済みかを判定する
 * conversations.replies を叩かずに reply_users フィールドで判定することで
 * レートリミットを回避する
 */
function hasMyReplyInSearchResult(msg, myUserId) {
  if (msg.reply_users && msg.reply_users.includes(myUserId)) return true;
  return false;
}

/**
 * メインスキャン処理
 * search.messages APIで自分へのメンション＋DMを効率的に検出する
 * @param {object} client Slack WebClient（Bot用・通知送信に使用）
 * @param {string} myUserId 自分のSlackユーザーID
 * @param {'morning'|'evening'} session
 * @param {Date} now 現在時刻
 * @returns {Array} 未返信メンションの配列
 */
async function scanMentions(client, myUserId, session, now) {
  const userToken = process.env.SLACK_USER_TOKEN;
  const { oldest, latest } = getScanRange(session, now);
  console.log('[scan] session=' + session
    + ' oldest=' + new Date(oldest * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    + ' latest=' + new Date(latest * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));

  // メンション検索 + DM検索（並列）
  const [mentionMessages, dmMessages] = await Promise.all([
    searchMentions(userToken, myUserId, oldest, latest),
    searchDMs(userToken, oldest, latest),
  ]);
  console.log('[scan] mention hits=' + mentionMessages.length + ' DM hits=' + dmMessages.length);

  // 重複排除してマージ
  const seen = new Set();
  const allMessages = [];
  for (const msg of [...mentionMessages, ...dmMessages]) {
    const key = (msg.channel && msg.channel.id) + '_' + msg.ts;
    if (!seen.has(key)) {
      seen.add(key);
      allMessages.push(msg);
    }
  }

  const unreplied = [];

  for (const msg of allMessages) {
    // 自分の投稿はスキップ
    if (msg.user === myUserId) continue;

    const channelId = msg.channel && msg.channel.id;
    if (!channelId) continue;

    // reply_users フィールドで返信済み判定（API追加呼び出しなし）
    if (hasMyReplyInSearchResult(msg, myUserId)) continue;

    unreplied.push({
      channelId,
      channelName: (msg.channel && (msg.channel.name || 'DM')) || 'DM',
      ts: msg.ts,
      text: (msg.text || '').substring(0, 120),
      user: msg.user,
    });
  }

  console.log('[scan] unreplied mentions=' + unreplied.length);
  return unreplied;
}

module.exports = { scanMentions };