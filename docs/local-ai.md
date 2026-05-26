# ローカルAI接続

このアプリは公開Webでは利用者自身のAPIキー入力を前提にします。一方、ローカル開発時はCodex App Serverを使い、APIキーをブラウザに入力せずにAI処理を試せます。

## 構成

```text
Browser
  -> Web App http://127.0.0.1:4173/
  -> Codex AI Bridge http://127.0.0.1:45124/codex-json
  -> Codex App Server ws://127.0.0.1:45123
```

ブラウザからCodex App ServerのWebSocketへ直接つなぐのではなく、`tools/codex-ai-bridge.mjs` をHTTPブリッジとして使います。

## 起動手順

Webアプリ:

```bash
npm run dev
```

Codex App Server:

```bash
npm run codex:app-server
```

HTTPブリッジ:

```bash
npm run codex:ai-bridge
```

画面の `AI設定`:

```text
Provider: Codex App Server (local bridge)
Base URL: http://127.0.0.1:45124/codex-json
Model: 空欄、またはCodex側で利用できるモデル名
API Key: 空欄
```

## うまく動かない場合

### Codex App Serverに接続できない

- `npm run codex:app-server` が起動しているか確認してください。
- `npm run codex:ai-bridge` が起動しているか確認してください。
- Base URLが `http://127.0.0.1:45124/codex-json` になっているか確認してください。

### AI応答が固定サンプルに戻る

AI呼び出しに失敗した場合、アプリは固定サンプルにfallbackします。画面上部のステータスに、接続失敗、タイムアウト、JSON Schema不一致などの理由が表示されます。

### JSON Schemaエラーが出る

Codex App Server連携では構造化出力のJSON Schemaを厳密に扱います。スキーマを変更した場合は、以下を確認してください。

- object型は `properties` と `required` が対応していること
- Codex向けに `additionalProperties: false` を満たせる構造であること
- 自由なキーを持つmap構造を避け、できるだけ固定プロパティにすること

### EChartsが表示されない

現在はCDNからEChartsを読み込みます。インターネットに接続できない環境では、図表が表示されないことがあります。完全オフラインで使う場合は、EChartsをローカルに配置して `index.html` のscript参照を差し替えてください。
