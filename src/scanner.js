const { WebClient } = require('@slack/web-api');
const { getScanRange } = require('./holidays');


/**
 * 自分が参加している全チャンネルIDを取得（ユーザートークン使用）
 */
async function getMyChannels(myUserId, userToken) {
  const userClient = new WebClient(userToken);
  let channels = [];
  let cursor;
  do {
    const res = await userClient.users.conversations({
      user: myUserId,
      types: 'public_channel,private_channel,im,mpim',
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    channels = channels.concat(res.channels || []);
    cursor = res.response_metadata && res.response_metadata.next_cursor;
  } while (cursor);
  return channels;
}


/**
 * チャンネルの履歴をページネーション込みで取得（ユーザートークン使用）
 */
async function fetchMessages(userToken, channelId, oldest, latest) {
  const userClient = new WebClient(userToken);
  let messages = [];
  let cursor;
  do {
    const res = await userClient.conversations.history({
      channel: channelId,
      oldest: String(oldest),
      latest: String(latest),
      limit: 200,
      cursor,
    });
    messages = messages.concat(res.messages || []);
    cursor = res.response_metadata && res.response_metadata.next_cursor;
  } while (cursor);
  return messages;
}


/**
 * メッセージが自分へのメンションを含むか判定
 * @mention / @channel / @here を対象とする
 */
function mentionsMe(text, myUserId) {
  if (!text) return false;
  const directMention = new RegExp('<@' + myUserId + '>', 'i');
  return directMention.test(text) || /<!channel>|<!here>/i.test(text);
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
 * チャンネル・DM問わず自分へのメンション・未返信メッセージを検出する
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

  const channels = await getMyChannels(myUserId, userToken);
  console.log('[scan] joined channels=' + channels.length);

  const unreplied = [];

  for (const channel of channels) {
    let messages;
    try {
      messages = await fetchMessages(userToken, channel.id, oldest, latest);
    } catch (err) {
      console.warn('[scan] skip channel=' + (channel.name || channel.id) + ' err=' + err.message);
      continue;
    }

    for (const msg of messages) {
      // ボット・システムメッセージはスキップ
      if (msg.bot_id || msg.subtype) continue;
      // 自分の投稿はスキップ
      if (msg.user === myUserId) continue;

      // DMの場合はメンション判定をスキップ（自分宛のメッセージ全て対象）
      const isDM = channel.is_im || channel.is_mpim;
      if (!isDM && !mentionsMe(msg.text, myUserId)) continue;

      const replied = await hasMyReply(userToken, channel.id, msg.ts, myUserId);
      if (replied) continue;

      unreplied.push({
        channelId: channel.id,
        channelName: channel.name || 'DM',
        ts: msg.ts,
        text: (msg.text || '').substring(0, 120),
        user: msg.user,
      });
    }
  }

  console.log('[scan] unreplied mentions=' + unreplied.length);
  return unreplied;
}


module.exports = { scanMentions };