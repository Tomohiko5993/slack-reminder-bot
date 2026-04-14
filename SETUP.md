# Personal Slack Reminder Bot — セットアップガイド

## 概要

自分へのメンション（@自分 / @channel / @here）を含む未返信メッセージを
毎日 朝8:00 と 夕18:00 にスキャンし、DM1通でまとめて通知するパーソナルボット。

- 平日のみ稼働（土日・日本の祝日は自動スキップ）
- 月曜朝は金曜18:00以降（土日丸ごと）を回収
- OpenAI API 不要・シンプル構成

---

## ファイル構成

```
slack-reminder-bot/
├── src/
│   ├── index.js       # メインアプリ・cronスケジューラ
│   ├── scanner.js     # チャンネルスキャン・未返信判定
│   ├── notifier.js    # DM通知送信
│   └── holidays.js    # 祝日判定・スキャン時間範囲計算
├── .env.example
├── .gitignore
├── package.json
├── Procfile
└── runtime.txt
```

---

## スキャン範囲ロジック

| 実行タイミング | スキャン対象期間 |
|-------------|--------------|
| 火〜金 朝8:00 | 前日18:00 〜 当日7:59 |
| **月曜 朝8:00** | **金曜18:00 〜 月曜7:59（土日丸ごと）** |
| 月〜金 夕18:00 | 当日8:00 〜 17:59 |
| 祝日 | スキップ（祝日翌朝に遡って回収） |

---

## Step 1: Slack App の作成

[https://api.slack.com/apps](https://api.slack.com/apps) → Create New App → From an app manifest

### App Manifest (YAML)

```yaml
display_information:
  name: Personal Reminder Bot
  description: Personal unanswered mention reminder
  background_color: "#01696f"
features:
  bot_user:
    display_name: Personal Reminder Bot
    always_online: true
  slash_commands:
    - command: /remind-now
      url: https://placeholder.example.com/slack/events
      description: Manually trigger mention scan (morning or evening)
      usage_hint: morning | evening
      should_escape: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - commands
      - groups:history
      - groups:read
      - im:write
      - users:read
settings:
  event_subscriptions:
    request_url: https://placeholder.example.com/slack/events
    bot_events:
      - app_mention
  interactivity:
    is_enabled: true
    request_url: https://placeholder.example.com/slack/events
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

### トークン取得

- `SLACK_BOT_TOKEN`: OAuth & Permissions → Install to Workspace → Bot User OAuth Token
- `SLACK_SIGNING_SECRET`: Basic Information → App Credentials → Signing Secret

---

## Step 2: 自分のユーザーIDを確認

Slackデスクトップアプリ:
1. 左上のプロフィールアイコンをクリック
2. 「プロフィールを表示」
3. 「その他」→「メンバーIDをコピー」

→ `U` で始まる文字列（例: `U0123456789`）

---

## Step 3: ローカル動作確認

```bash
npm install
cp .env.example .env
# .env に SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET / MY_SLACK_USER_ID を記入

npm run dev

# 別ターミナルでngrokを起動
npx ngrok http 3000
```

Slack App の Request URL を ngrok URLに更新して `/remind-now morning` を実行してテスト。

---

## Step 4: Heroku デプロイ

```bash
heroku login
heroku create your-reminder-bot-name

heroku config:set \
  SLACK_BOT_TOKEN=xoxb-xxx \
  SLACK_SIGNING_SECRET=xxx \
  MY_SLACK_USER_ID=U0123456789 \
  TZ=Asia/Tokyo

git add .
git commit -m "Initial deploy"
git push heroku main
heroku ps:scale web=1
heroku logs --tail
```

### Slack App の URL を更新

Heroku URL を以下3箇所に設定:
```
https://your-reminder-bot-name.herokuapp.com/slack/events
```
- Event Subscriptions → Request URL
- Slash Commands → /remind-now URL
- Interactivity → Request URL

---

## Step 5: 24時間稼働の維持

Heroku Scheduler でヘルスチェックを設定（Eco Dyno のスリープ防止）:

```bash
heroku addons:create scheduler:standard
heroku addons:open scheduler
```

スケジューラに追加:
- コマンド: `curl https://your-reminder-bot-name.herokuapp.com/health`
- 頻度: Every 10 minutes

---

## 手動テスト

デプロイ後、Slackで以下のコマンドを実行:

```
/remind-now morning   # 朝スキャンをテスト
/remind-now evening   # 夕スキャンをテスト
```

---

## 通知イメージ

未返信がある場合:
```
🔔 夕方の未返信メンション（3件）
─────────────────
1. #general
   @here 明日の定例MTGの議題を...  [返信する]

2. #project-alpha
   @あなた この件どう思いますか？  [返信する]

3. #dev-team
   @channel リリース確認お願いします  [返信する]
```

未返信がない場合:
```
✅ 夕方のチェック完了 — 未返信メンションはありません！
```

---

## トラブルシューティング

### チャンネルのメッセージが取得できない
→ ボットをチャンネルに招待: `/invite @Personal Reminder Bot`
→ ただし自分が参加しているチャンネルのみ自動スキャン対象のため、ボットも同じチャンネルにいる必要あり

### `MY_SLACK_USER_ID` が未設定エラー
→ `.env` または Heroku Config Vars に `MY_SLACK_USER_ID=U...` を設定

### 祝日が正しく判定されない
→ `@holiday-jp/holiday_jp` パッケージのデータが古い可能性: `npm update @holiday-jp/holiday_jp`
