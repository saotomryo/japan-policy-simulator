# 国版 政策シミュレーター アプリケーション仕様

## 1. MVPのゴール

日本を想定した国レベルの政策について、対象政策の指定、国民・ステークホルダーの想定反応生成、クラスター分析、AIチャットによる影響確認、単発の政策実行結果表示までを1回の流れで体験できるWebアプリケーションにする。

MVPでは政策の正解判定はしない。目的は、政策による便益、不利益、反発、無関心、財源上の懸念、国際関係への波及を可視化すること。

## 2. 実行環境

- 既存の静的Webアプリ構成を維持する
- `index.html`、`src/app.js`、`src/styles.css`、`data/` をHTTPサーバーで配信する
- AI Provider、保存、エクスポート、インポートの基本設計は既存の学校版を流用する
- EChartsを使った可視化を継続する
- 初期MVPではバックエンドDBを持たない

## 3. 主要ユーザーフロー

1. ユーザーがダッシュボードで日本の初期状態を見る
2. プリセット政策を選択する、または自由記述で政策を入力する
3. AIが政策ターゲットを構造化する
4. AIが関連指標と国民ペルソナの声を生成する
5. アプリが声を賛否、利害、無関心、実務、専門家、国際関係などの観点で表示する
6. クラスターマップと階層クラスタリングで意見構造を見る
7. ユーザーがチャットで、どのクラスターに効果・不利益・反発が出るか確認する
8. AIが初期政策案を生成する
9. ユーザーが必要に応じて政策案をチャットで調整する
10. ユーザーが政策を1回だけ実行する
11. アプリが短期結果、長期予想、財源上の懸念、国際関係クラスター別反応を表示する

## 4. 画面仕様

### 4.1 ダッシュボード

目的: 政策指定前の日本の初期状態を把握する。

表示するもの。

- 社会指標
- 経済・財政指標
- 政策実行指標
- 国際関係指標
- 国民属性の人口構成サマリー
- データ種別ラベル
  - 実統計値
  - 実統計参考値
  - 仮想指標
  - AI推定

主要コンポーネント。

- 指標カード
- レーダーチャート
- 国民属性構成バー
- 国際関係スコア一覧
- データ出典・基準年の簡易表示

MVPの制約。

- 実統計値の自動更新はしない
- 初期値はJSONに固定する
- 出典URLや基準年はメタデータとして持つが、アプリ内取得は後続検討

### 4.2 政策ターゲット

目的: シミュレーション対象の政策を決める。

入力。

- プリセット政策の選択
- 自由記述の政策入力
- 政策強度の指定
  - 小規模
  - 標準
  - 大規模

MVPプリセット。

- 消費税減税
- 子育て支援給付の拡充
- 行政DXの推進

AIが構造化して表示するもの。

- 政策名
- 政策概要
- AI生成の政策分野
- 主対象
- 主要な受益者
- 主要な負担者
- 想定財源
- 実施期間
- 関連指標
- 主な論点
- 財源上の注意

操作。

- `政策を分析する`
- `自由記述を政策ターゲット化`
- `この政策で進める`

### 4.3 声の分析

目的: 政策に対する国民・ステークホルダーの想定反応を確認する。

表示するもの。

- 代表発話カード
- 発話者ペルソナ
- 賛否分類
- 利害分類
- 感情強度
- 政策理解度
- 関連指標
- 関連クラスター

発話カテゴリ。

- 肯定的な声
- 否定的な声
- 条件付き賛成
- 条件付き反対
- 利害関係者の声
- 実務現場の声
- 専門家の懸念
- 無関心層の声
- 将来世代への懸念
- 代替案を求める声
- 国際関係上の懸念

可視化。

- 意見クラスターマップ
- 階層クラスタリング
- 賛成・反対・条件付き・無関心の構成比
- 便益クラスター、不利益クラスター、反発クラスターの一覧
- 世代別の想定効果
- 所得別の想定効果

世代や所得との関連が薄い政策では、世代別・所得別の効果値は必須にしない。AIは無理に差を作らず、関係が薄い場合は「該当性が低い」「大きな差は想定しにくい」として扱う。

### 4.4 政策分析チャット

目的: クラスター別影響を対話的に確認し、政策案へ反映する。

チャットが参照する文脈。

- ベース指標
- 政策ターゲット
- 関連指標
- 国民ペルソナ
- 発話とクラスター
- 国際関係クラスター
- 財源上の注意
- 現在の政策案

チャットでできること。

- 効果が期待できる層を聞く
- 不利益が集中する層を聞く
- 反対論点を聞く
- 無関心層が関心を持つ条件を聞く
- 財源案を変えた場合の反応を見る
- 対象範囲を変えた場合の反応を見る
- 国際関係への影響を聞く
- 政策案の修正を依頼する

AI回答に含めるもの。

- 要約
- 関連クラスターID
- 関連指標ID
- 想定される声
- 政策案への反映提案
- 財源・実装・説明責任上の注意

### 4.5 政策案

目的: 実行する政策案の内容とリスクを確認する。

表示するもの。

- 政策名
- 概要
- 対象者
- 実施手段
- 実施コスト
- 財源案
- 短期効果
- 長期影響の予想
- 便益が大きいクラスター
- 不利益が出るクラスター
- 反発が強いクラスター
- 世代別の期待効果
- 所得別の期待効果
- 国際関係への影響
- 実装リスク
- 説明責任上の論点

制約。

- 財源制約は強制的な失敗条件にしない
- ただし、現実的な財源制約を超える案には警告を出す
- 初期生成政策は、現実的な財源制約の範囲に収めることをAIに要求する

### 4.6 実行結果

目的: 単発の政策実行結果を短期中心に確認する。

表示するもの。

- 短期の指標変化
- 財政影響
- 国民クラスター別の便益、不利益、納得度
- 世代別の短期効果
- 所得別の短期効果
- 支持、反対、条件付き、無関心の変化
- 国際関係クラスター別反応
- 想定外の副作用
- メディア・世論上の争点化
- 行政現場への負荷
- 長期予想
- 長期リスク
- 長期的に観測すべき指標
- 政策実行レポート

実行制約。

- 1シミュレーションにつき政策実行は1回
- 実行後は政策案の再編集をロックする
- 再試行したい場合は新規シミュレーションとして開始する

## 5. データモデル

### 5.1 SimulationState

```json
{
  "schemaVersion": "national-policy-sim-v1",
  "scenario": {},
  "baseMetrics": [],
  "internationalRelations": [],
  "populationSegments": [],
  "personas": [],
  "policyTarget": null,
  "voices": [],
  "voiceAnalysis": {},
  "policyChat": [],
  "policyDraft": null,
  "executionResult": null,
  "aiConfig": {},
  "saveMeta": {}
}
```

### 5.2 BaseMetric

```json
{
  "id": "household_disposable_income",
  "label": "家計可処分所得",
  "category": "economy",
  "value": 52,
  "unit": "score",
  "sourceType": "official_stat",
  "sourceLabel": "政府統計を参考にした固定初期値",
  "baseYear": 2025,
  "visible": true,
  "description": "家計の余力を示す指標"
}
```

`sourceType` は以下。

- `official_stat`
- `official_stat_reference`
- `fixed_virtual`
- `ai_estimated`

### 5.3 InternationalRelationCluster

```json
{
  "id": "us",
  "label": "アメリカ",
  "relationScore": 72,
  "economicDependency": 68,
  "securitySensitivity": 90,
  "publicOpinionSensitivity": 62,
  "supplyChainImportance": 70,
  "reactionMemo": "安全保障と通商の両面で影響が大きい"
}
```

初期クラスター。

- `us`
- `eu`
- `china`
- `asia`
- `global_south`
- `international_orgs`

### 5.4 PopulationSegment

人口構成に近づけるための集計単位。

```json
{
  "id": "age_65_plus",
  "label": "65歳以上",
  "axis": "age",
  "ratio": 29.0,
  "sourceType": "official_stat_reference"
}
```

主な軸。

- 年齢
- 地域
- 所得
- 世帯構成
- 職業・産業
- 雇用形態

### 5.5 Persona

声を生成するための複合ペルソナ。単一属性ではなく複数軸の組み合わせにする。

```json
{
  "id": "persona_001",
  "label": "地方在住の高齢・保守層",
  "populationWeight": 4.5,
  "axes": {
    "age": "65歳以上",
    "region": "地方",
    "income": "中間層",
    "occupation": "年金生活・地域活動",
    "household": "夫婦のみ",
    "politicalValue": "保守層",
    "supportNetwork": "地域コミュニティ重視層",
    "media": "テレビ・新聞中心",
    "politicalEngagement": "高い",
    "governmentTrust": 62
  },
  "interests": ["社会保障", "地域医療", "物価", "安全保障"],
  "sensitivity": {
    "tax": 0.7,
    "welfare": 0.9,
    "security": 0.8,
    "digitalization": 0.4
  }
}
```

政治的立場、宗教・支持組織、社会運動との近さは、実在個人の推定ではなく仮想ペルソナの反応軸として使う。同じカテゴリ内でも賛成、反対、条件付き賛成、無関心があり得る。

### 5.6 PolicyTarget

```json
{
  "id": "policy_consumption_tax_cut",
  "title": "消費税減税",
  "summary": "消費税率を一時的に引き下げ、家計負担を軽減する",
  "aiGeneratedField": "税制・家計支援",
  "primaryTargets": ["家計", "低所得層", "中小企業"],
  "beneficiaries": ["消費者", "小売・サービス業"],
  "burdenGroups": ["将来世代", "財政運営", "社会保障財源に依存する層"],
  "fundingAssumption": "国債増発または歳出見直し",
  "implementationPeriod": "短期",
  "intensity": "standard",
  "relatedMetricIds": ["household_disposable_income", "tax_burden_feeling", "fiscal_capacity"],
  "keyIssues": ["財源", "景気刺激", "社会保障財源", "低所得層への効果"]
}
```

### 5.7 Voice

```json
{
  "id": "voice_001",
  "personaId": "persona_001",
  "speakerName": "地方在住の70代男性",
  "stance": "conditional_support",
  "stakeholderType": "citizen",
  "mood": "期待と懸念",
  "text": "物価が上がっているので減税は助かるが、医療や介護の財源が削られるなら不安もある。",
  "relatedMetricIds": ["tax_burden_feeling", "social_security_sustainability"],
  "intensity": 0.72,
  "policyUnderstanding": 0.6
}
```

`stance` は以下。

- `support`
- `oppose`
- `conditional_support`
- `conditional_oppose`
- `stakeholder_concern`
- `indifferent`
- `expert_concern`
- `implementation_concern`
- `international_concern`

### 5.8 VoiceCluster

```json
{
  "id": "cluster_tax_relief_support",
  "label": "家計負担軽減を重視する支持層",
  "size": 24,
  "sentiment": 0.68,
  "x": 0.2,
  "y": -0.4,
  "stanceMix": {
    "support": 55,
    "conditional_support": 35,
    "oppose": 5,
    "indifferent": 5
  },
  "keywords": ["物価", "家計", "消費", "減税"],
  "summary": "物価負担への即効性を評価するが、恒久化や財源には慎重。",
  "representativeVoiceIds": ["voice_001"]
}
```

### 5.9 SegmentEffect

世代別・所得別の効果を表す共通構造。

```json
{
  "segmentId": "age_18_29",
  "segmentLabel": "18から29歳",
  "axis": "generation",
  "applicability": "applicable",
  "effectScore": 12,
  "benefitLevel": "medium",
  "riskLevel": "low",
  "summary": "短期的な可処分所得改善の効果はあるが、世帯形成前の層では直接効果は限定的。",
  "reason": "消費支出への影響はあるが、子育て支援ほど対象が集中しないため"
}
```

`axis` は以下。

- `generation`
- `income`

`applicability` は以下。

- `applicable`
- `low_relevance`
- `not_applicable`

`benefitLevel` と `riskLevel` は以下。

- `high`
- `medium`
- `low`
- `none`

`applicability` が `low_relevance` または `not_applicable` の場合、`effectScore` は `null` にできる。

### 5.10 PolicyDraft

```json
{
  "id": "draft_001",
  "title": "時限的な消費税減税と低所得世帯補完策",
  "summary": "1年間の消費税率引き下げと、社会保障財源への補填を組み合わせる",
  "targetPolicyId": "policy_consumption_tax_cut",
  "implementationDetails": [],
  "costEstimate": {
    "amount": 0,
    "unit": "兆円",
    "confidence": "rough"
  },
  "fundingPlan": "国債増発と一部歳出見直し",
  "fiscalWarnings": [],
  "expectedShortTermEffects": {},
  "longTermOutlook": {},
  "benefitClusters": [],
  "harmClusters": [],
  "oppositionClusters": [],
  "generationEffects": [],
  "incomeEffects": [],
  "internationalImpacts": [],
  "implementationRisks": [],
  "accountabilityIssues": []
}
```

### 5.11 ExecutionResult

```json
{
  "summary": "短期的には家計負担感が下がり支持は増えるが、財源懸念が強まった。",
  "shortTermMetricDeltas": {},
  "fiscalImpact": {},
  "clusterImpacts": [],
  "generationEffects": [],
  "incomeEffects": [],
  "internationalReactions": [],
  "publicOpinionShift": {},
  "unexpectedSideEffects": [],
  "administrativeLoad": {},
  "longTermOutlook": {
    "summary": "長期的には社会保障財源と財政余力を継続観測する必要がある。",
    "risks": [],
    "watchMetricIds": []
  },
  "report": ""
}
```

## 6. AI処理仕様

### 6.1 `structurePolicyTarget`

入力。

- プリセット政策ID、または自由記述
- 政策強度
- ベース指標

出力。

- `PolicyTarget`
- 関連指標ID
- 財源上の注意
- 政策分野はAI生成

### 6.2 `generatePolicyVoices`

入力。

- `PolicyTarget`
- `BaseMetric[]`
- `InternationalRelationCluster[]`
- `PopulationSegment[]`
- `Persona[]`

出力。

- `Voice[]`
- `VoiceCluster[]`
- 階層クラスタリング
- 賛否・無関心・条件付きの構成比

生成条件。

- 人口構成に近いペルソナ比率を尊重する
- 政治的立場や宗教・支持組織は単独ラベルではなく複合ペルソナ軸として使う
- 特定集団を一枚岩にしない
- 肯定、否定、条件付き、無関心、実務、専門家、国際関係の声を含める

### 6.3 `generateInitialPolicyDraft`

入力。

- `PolicyTarget`
- `VoiceAnalysis`
- 財政関連指標
- チャット履歴

出力。

- `PolicyDraft`

生成条件。

- 現実的な財源制約の範囲を意識する
- 財源上の懸念は必ず出す
- 短期効果と長期予想を分離する
- 便益、不利益、反発、無関心層への影響を含める
- 政策と関係がある場合は、世代別・所得別の期待効果を含める
- 世代や所得との関連が薄い場合は、効果値を無理に生成せず該当性が低い理由を含める

### 6.4 `discussPolicyImpact`

入力。

- ユーザー発話
- `SimulationState`

出力。

- チャット回答
- 参照したクラスターID
- 参照した指標ID
- 政策案への反映提案
- 必要に応じた `PolicyDraft` 更新案

### 6.5 `simulatePolicyExecution`

入力。

- `SimulationState`
- 確定した `PolicyDraft`

出力。

- `ExecutionResult`

生成条件。

- 短期結果を中心にする
- 長期は確定結果ではなく予想として出す
- 財源、行政負荷、国際関係への反応を含める
- 政策と関係がある場合は、世代別・所得別の短期効果を含める
- 世代や所得との関連が薄い場合は、`not_applicable` と理由を返す
- 指標変化はアプリ側の許容範囲で検証する

## 7. JSON Schema方針

MVPで新規または置換するスキーマ。

- `national-initial-state.schema.json`
- `policy-target.schema.json`
- `national-persona.schema.json`
- `national-voice.schema.json`
- `national-voice-analysis.schema.json`
- `national-policy-draft.schema.json`
- `policy-impact-chat-message.schema.json`
- `national-simulation-result.schema.json`
- `national-save-file.schema.json`

既存スキーマから流用する考え方。

- `opinion.schema.json` -> `national-voice.schema.json` に拡張
- `policy-draft.schema.json` -> `national-policy-draft.schema.json` に置換
- `ai-simulation-result.schema.json` -> `national-simulation-result.schema.json` に置換
- `save-file.schema.json` -> `national-save-file.schema.json` に置換

## 8. 初期データ方針

初期データファイル。

- `data/scenarios/national/dashboard.json`

含めるもの。

- ベース指標
- 国際関係クラスター
- 人口構成セグメント
- 複合ペルソナのテンプレート
- MVPプリセット政策
- 固定サンプル用の声、分析、政策案、実行結果

実統計値の扱い。

- 実統計値がある指標は固定初期値として設定する
- `sourceType`、`sourceLabel`、`baseYear` を持つ
- アプリ内更新は行わない
- 出典の正確な確定は後続タスクにする

## 9. 保存仕様

保存対象。

- `SimulationState`
- 選択した政策ターゲット
- 生成された声とクラスター
- チャット履歴
- 政策案
- 実行結果
- データ基準年と出典ラベル

保存しないもの。

- APIキー
- セッション限定の認証情報

保存ID。

- 既存のIndexedDB保存を流用
- DB名は `national-policy-simulator` に変更する

## 10. MVP実装順

1. `data/scenarios/national/dashboard.json` を追加する
2. 画面文言を学園から国版へ差し替える
3. ダッシュボードを国版指標に差し替える
4. 課題設定画面を政策ターゲット画面へ置き換える
5. `issues` 依存を `policyTarget` / `policyTargets` に置き換える
6. 生徒グループを国民ペルソナと人口セグメントへ置き換える
7. 声の分析を国民・ステークホルダー向けに拡張する
8. 政策分析チャットを追加する
9. 政策案生成を国版 `PolicyDraft` に置き換える
10. 政策実行を単発実行に変更する
11. 実行後の再編集ロックを追加する
12. 保存・インポート・エクスポートを国版状態に対応させる
13. 新規JSON Schemaを追加してAI出力を検証する

## 11. MVP完了条件

- プリセット政策を1つ選んで分析を開始できる
- 自由記述政策をAIが政策ターゲット化できる
- 国民ペルソナの声が生成される
- 声をクラスターとして可視化できる
- チャットでクラスター別影響を質問できる
- AIが政策案を生成できる
- 政策を1回だけ実行できる
- 短期結果と長期予想が分離して表示される
- 財源上の懸念が表示される
- 国際関係クラスター別反応が表示される
- 保存とエクスポートができる

## 12. 非ゴール

MVPでは以下を行わない。

- 実統計値のオンライン自動更新
- 実在個人の推定
- 選挙結果の予測
- 政党支持率の実測予測
- 長期結果の確定シミュレーション
- 複数ターンの政策運営
- 財源制約による強制ゲームオーバー
- 政策の正解判定
