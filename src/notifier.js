/**
 * 未返信メンション一覧をDM1通にまとめて送信
 */
async function sendSummaryDm(client, myUserId, unreplied, session) {
  const label = session === 'morning' ? '朝' : '夕方';
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  if (unreplied.length === 0) {
    // 未返信なし → 軽いDMのみ
    const dm = await client.conversations.open({ users: myUserId });
    await client.chat.postMessage({
      channel: dm.channel.id,
      text: ':white_check_mark: ' + label + 'のチェック完了 — 未返信メンションはありません！',
    });
    return;
  }

  // ─── ブロック構築 ────────────────────────────────────────
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: ':bell: ' + label + 'の未返信メンション（' + unreplied.length + '件）',
        emoji: true,
      },
    },
    { type: 'divider' },
  ];

  unreplied.forEach(function(item, i) {
    const link = 'https://slack.com/archives/' + item.channelId
      + '/p' + item.ts.replace('.', '');

    // テキストを短縮表示
    const preview = item.text.length > 80
      ? item.text.substring(0, 80) + '...'
      : item.text;

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*' + (i + 1) + '.* #' + item.channelName + '\n' + preview,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '返信する', emoji: true },
        url: link,
        action_id: 'reply_' + i,
      },
    });
  });

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: '_Personal Reminder Bot • ' + now + '_',
    }],
  });

  const dm = await client.conversations.open({ users: myUserId });
  await client.chat.postMessage({
    channel: dm.channel.id,
    text: label + 'の未返信メンションが ' + unreplied.length + ' 件あります',
    blocks: blocks,
  });

  console.log('[notifier] DM sent: ' + unreplied.length + ' items');
}

module.exports = { sendSummaryDm };
