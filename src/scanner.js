const { WebClient } = require('@slack/web-api');
const { getScanRange } = require('./holidays');

/**
 * search.messages API で自分へのメンション・DMを検索する
 * 全チャンネルをスキャンする代わりにSlack側で絞り込むためレートリミットに当たらない
 */
async function searchMentions(userToken, myUserId, oldest, latest) {
  const userClient = new WebClient(userToken);

  // 検索クエリ: 自分へのメンション OR @channel OR @here
  const query = `<@${myUserId}> OR @channel OR @here`;

  const oldestDate = new Date(oldest * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
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

  return messages;
}

/**
 * DM（自分宛）を search.messages で取得する
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

  return messages;
}

/**
 * 自分がスレッドに返信済みかどうかを確認（ユーザートークン使用）
 */
async function hasMyReply(userToken, channelId, messageTs, myUserId) {
  const userClient = new WebClient(userToken);
  try {
    const res = await userClient.conversations.replies({
      channel: channelId,
      ts: messageTs,
      limit: 50,
    });
    const replies = (res.messages || []).slice(1); // 先頭は元メッセージ
    return replies.some(r => r.user === myUserId);
  } catch (_) {
    return false;
  }
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

  // メンション検索
  const mentionMessages = await searchMentions(userToken, myUserId, oldest, latest);
  console.log('[scan] mention hits=' + mentionMessages.length);

  // DM検索
  const dmMessages = await searchDMs(userToken, oldest, latest);
  console.log('[scan] DM hits=' + dmMessages.length);

  // 重複排除してマージ（channel.id + ts をキーに）
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

    const replied = await hasMyReply(userToken, channelId, msg.ts, myUserId);
    if (replied) continue;

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