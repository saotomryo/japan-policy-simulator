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

## 現在AI化している処理

- 政策ターゲット決定後の国民・ステークホルダーの声生成
- 作成した声を入力にした意見クラスター、距離マップ、階層クラスタの生成
- 声とクラスター分析を入力にした初期政策案と実施内容別コスト内訳の生成
- 政策案チャットによる修正
- 政策実行結果の生成

消費税減税など事前モックがある政策は、再現性を優先して用意済みモックデータを使います。AI ProviderとしてCodex App ServerやOpenAIを選んでいる場合、AI接続に失敗しても固定サンプルへ自動fallbackしません。エラーを表示し、ユーザーがリトライまたはキャンセルを選択します。固定サンプルを使う場合は、Providerで明示的に `固定サンプル` を選びます。

政策ターゲット生成は、単一プロンプトでまとめて作らず、次の3段階で実行します。

1. `national-voices`: 政策方向を判定し、国民・ステークホルダーの代表発話を作成
2. `national-voice-analysis`: 作成済みの声だけを根拠にクラスター分析を作成
3. `national-initial-policy`: 声とクラスター分析を入力に、初期政策案、属性別効果、コスト内訳を作成

増税、社会保険料増、自己負担増、給付削減などの負担増政策では、補償策が明記されない限り、反対・慎重・不安の比率が過半になるようにプロンプトで制約しています。

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

### AI接続エラーが出る

AI呼び出しに失敗した場合、アプリは固定サンプルへ自動fallbackせず、エラーダイアログを表示します。リトライする場合は、Codex App Server、HTTPブリッジ、APIキー、Base URL、JSON Schema応答を確認してから実行してください。固定サンプルで進めたい場合は、AI設定でProviderを `固定サンプル` に切り替えます。

### JSON Schemaエラーが出る

Codex App Server連携では構造化出力のJSON Schemaを厳密に扱います。スキーマを変更した場合は、以下を確認してください。

- object型は `properties` と `required` が対応していること
- Codex向けに `additionalProperties: false` を満たせる構造であること
- 自由なキーを持つmap構造を避け、できるだけ固定プロパティにすること

### EChartsが表示されない

現在はCDNからEChartsを読み込みます。インターネットに接続できない環境では、図表が表示されないことがあります。完全オフラインで使う場合は、EChartsをローカルに配置して `index.html` のscript参照を差し替えてください。
