# 日本版　仮想政策シミュレーター

日本を想定した国レベルの政策シミュレーションWebアプリケーションのプロトタイプです。

ユーザーは、対象政策を指定し、関連指標、国民・ステークホルダーの想定される声、賛否・利害・無関心層の分布、世代別・所得別の効果、国際関係クラスターへの波及を確認しながら、1回だけ政策を実行します。

目的は政策の正解を出すことではなく、政策がどの層に便益や不利益をもたらし、どの論点で支持・反発・無関心が生まれるかを可視化することです。

## MVP方針

- 舞台は日本
- 対象政策はプリセット選択または自由記述で指定
- 課題選択フローは廃止し、最初に政策ターゲットを決める
- 政策分野はAI生成に任せる
- 初期プリセット政策は2から3個に絞る
- 実統計値が使える指標は固定初期値として使う
- 国民属性はできるだけ人口構成に近づける
- 国民の声は単純クラスターではなく、世代、地域、所得、職業、政治的立場、宗教・支持組織との近さなどを組み合わせた仮想ペルソナから生成する
- 政策実行は1回のみ
- 実行結果は短期結果と属性別影響を中心にし、長期影響欄はMVPでは非表示にする
- 財源制約は強制的な失敗条件にしないが、懸念は必ず表示する

## 現在の状態

このリポジトリは、学園自治シミュレーターをベースに国版政策シミュレーターへ作り替えている途中です。

現時点では、国版の主要導線をモックデータで動かせます。ダッシュボード、政策ターゲット、声の分析、政策案、実行結果の画面を国版へ差し替え済みです。AI接続が有効な場合、政策ターゲット決定後に「声の作成」「クラスター分析」「初期政策案・コスト内訳作成」の3段階でJSON Schemaに沿って生成します。内部互換のため一部に学園版由来のデータキーは残しています。

## 想定する主要画面

- ダッシュボード: 日本の社会、経済、財政、政策実行、国際関係指標を表示
- 政策ターゲット: プリセット政策または自由記述から政策対象を指定し、`声の分析へ進む` で仮想データと初期政策案を生成
- 声の分析: 国民・ステークホルダーの代表発話と意見クラスターを可視化。AI接続時はターゲットに応じて生成し、事前モックがある政策は用意済みデータを優先利用
- 政策分析チャット: クラスター別の効果、不利益、反発、財源、国際関係への影響を確認
- 政策案: 初期政策案、コスト内訳、財源上の注意、世代別・所得別・産業別効果をタブで表示
- 実行結果: 短期結果、影響の大きい分野、属性別反応、可視化グラフを含む詳細レポートを表示

## 動作環境

- Node.js 18以上
- Python 3
- Codex CLI、Codex App Server連携を使う場合のみ
- インターネット接続。ECharts CDNを読み込むため、オフライン運用ではEChartsのローカル配置が必要です

このリポジトリは現時点ではビルド工程のない静的Webアプリです。`index.html`、`src/`、`data/` をHTTPサーバーで配信して動作します。

## ローカル起動

```bash
npm run dev
```

ブラウザで次を開きます。

```text
http://127.0.0.1:4173/
```

`file://` で直接 `index.html` を開くと、JSONデータやスキーマの読み込みがブラウザ制約で失敗することがあります。必ずHTTPサーバー経由で起動してください。

## AI設定

画面右上の `AI設定` からProviderを選ぶ想定です。

| Provider | 用途 | APIキー |
| --- | --- | --- |
| 固定サンプル | 開発・fallback用 | 不要 |
| Codex App Server | ローカルのCodexでAI処理を行う | 不要 |
| OpenAI Responses | OpenAI Responses APIを使う | 必要 |
| OpenAI互換 Chat Completions | OpenAI互換APIをBase URL差し替えで使う | 必要 |

公開Webでは運営側APIキーを持たない前提です。ユーザーが自分のAPIキーを入力して使います。APIキーは保存ファイルには含めず、ブラウザのセッション内だけで保持します。

## Codex App Serverで使う

ローカルでCodexの認証状態を使う場合は、3つのプロセスを起動します。

1つ目のターミナルでWebアプリを起動します。

```bash
npm run dev
```

2つ目のターミナルでCodex App Serverを起動します。

```bash
npm run codex:app-server
```

3つ目のターミナルで、ブラウザから呼べるHTTPブリッジを起動します。

```bash
npm run codex:ai-bridge
```

その後、アプリの `AI設定` で次のように設定します。

```text
Provider: Codex App Server (local bridge)
Base URL: http://127.0.0.1:45124/codex-json
API Key: 空欄
```

## 開発用コマンド

```bash
npm run dev
npm run check
npm run codex:app-server
npm run codex:ai-bridge
```

`npm run check` は `src/app.js` の構文チェックを行います。

## ディレクトリ構成

```text
.
├── index.html
├── package.json
├── data/
│   ├── scenarios/
│   └── schemas/
├── docs/
├── src/
│   ├── app.js
│   └── styles.css
└── tools/
    └── codex-ai-bridge.mjs
```

## 関連ドキュメント

- [docs/national-policy-simulator-requirements.md](docs/national-policy-simulator-requirements.md)
- [docs/national-policy-application-spec.md](docs/national-policy-application-spec.md)
- [docs/national-policy-screen-spec.md](docs/national-policy-screen-spec.md)
- [docs/national-policy-development-plan.md](docs/national-policy-development-plan.md)
- [docs/local-ai.md](docs/local-ai.md)

## 画面モック

画面検討用の静的モックは以下です。

- [mockups/national-policy-screen-mock.html](mockups/national-policy-screen-mock.html)

## 注意

現在はプロトタイプ段階です。AI出力はJSON Schemaで検証する想定ですが、政策判断の正解を提供するものではありません。表示される国民の声、属性、指標、政策結果は、実統計値を参考にする場合を除き仮想データです。

## ライセンス

MIT Licenseです。利用・改変・再配布に制限は設けませんが、著作権表示とライセンス表示は保持してください。
