// Claude を「DAW オペレーター兼作曲アシスタント」として使う（任意機能）。
// アプリ内のアクション（actions.js）を Claude のツールとして渡し、ツール呼び出しのループを回す。
// API キーはブラウザの localStorage にだけ保存され、Anthropic API 以外には送られない。

import { ACTIONS, runAction } from "./actions.js";
import { keyName } from "./theory.js";
import { sortChords } from "./generate.js";

const SDK_URL = "https://esm.sh/@anthropic-ai/sdk@0.128.0";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5（高品質）" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5（バランス）" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5（高速・低コスト）" },
];
// 安全分類器で断られたときにサーバー側で別モデルへ切り替える機能が使えるモデル
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

const SYSTEM_PROMPT = `あなたはブラウザ上の DAW「Daruma DAW」のオペレーター兼作曲アシスタントです。
ユーザーの指示に従って、用意されたツールで曲を実際に編集します。

# DAW の仕様
- 拍子は 4/4 固定。時間の単位は「拍」（4分音符=1、1小節=4拍）。ツールの start は曲頭からの拍で 0 始まり、start_bar / 小節番号は 1 始まり。
- 音高は 'C4'（中央ド=MIDI 60）形式か MIDI 番号。ドラムは GM 配置（36 キック, 38 スネア, 39 クラップ, 42 クローズドハット, 46 オープンハット, 49 クラッシュ, 45/50 タム）。
- コード進行は曲データの chords に保存され、メロディ・ベース生成はそれを参照する。コード進行を変えたら、必要に応じてベースやメロディも作り直す。

# 振る舞い
- 曲を変更する依頼には、まずツールで実行してから、何をしたかを短く日本語で伝える。
- 現在の状態が必要なら get_project を使う（ノート詳細は include_notes）。
- 生成ツール（generate_*）で足りない細かい表現（キメ、フレーズの手直し、特定のリズム）は add_notes で直接書く。
- 作曲の相談には、音楽理論的な理由（機能和声、テンション、ボイスリーディング、リズムの対比など）を添えて具体的に提案する。曖昧な依頼でも、まず一案を作って聴かせ、別案の方向性を示す。
- 返答は簡潔に。`;

let sdkPromise = null;
function loadSdk() {
  sdkPromise ??= import(/* @vite-ignore */ SDK_URL);
  return sdkPromise;
}

export function toolDefinitions() {
  return ACTIONS.map((a) => ({ name: a.name, description: `${a.title}: ${a.description}`, input_schema: a.input_schema }));
}

function stateDigest(p) {
  const chords = sortChords(p.chords)
    .map((c) => `${c.bar + 1}${c.beat ? "." + (c.beat + 1) : ""}:${c.symbol}`)
    .join(" ");
  const tracks = p.tracks.map((t, i) => `${i + 1}.${t.name}(${t.instrument}, ${t.notes.length}音${t.mute ? ", mute" : ""}${t.solo ? ", solo" : ""})`).join(" / ");
  return `[現在の曲] ${p.bpm}BPM, キー ${keyName(p.key)}, ${p.bars}小節, ループ ${p.loop.enabled ? `${p.loop.startBar + 1}-${p.loop.endBar}` : "off"}\nコード: ${chords || "なし"}\nトラック: ${tracks}`;
}

export class ClaudeOperator {
  constructor({ apiKey, model = MODELS[0].id, ctx }) {
    this.apiKey = apiKey;
    this.model = model;
    this.ctx = ctx;
    this.messages = [];
    this.client = null;
  }

  reset() {
    this.messages = [];
  }

  async getClient() {
    if (this.client) return this.client;
    const mod = await loadSdk();
    this.Anthropic = mod.default;
    this.client = new this.Anthropic({ apiKey: this.apiKey, dangerouslyAllowBrowser: true });
    return this.client;
  }

  /**
   * ユーザーの発話を処理
   * @param {string} text
   * @param {{onText?:(t:string)=>void, onTool?:(name:string, input:object, result:{ok:boolean,message:string})=>void}} hooks
   */
  async send(text, hooks = {}) {
    const client = await this.getClient();
    const tools = toolDefinitions();
    this.messages.push({ role: "user", content: [{ type: "text", text: `${stateDigest(this.ctx.store.project)}\n\n${text}` }] });

    for (let turn = 0; turn < 16; turn++) {
      const params = {
        model: this.model,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools,
        messages: this.messages,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      };
      if (FALLBACK_MODELS.has(this.model)) {
        params.betas = ["server-side-fallback-2026-07-01"];
        params.fallbacks = "default";
      }

      let response;
      try {
        response = await client.beta.messages.create(params);
      } catch (e) {
        // 失敗したユーザー発話は履歴から外して、次回に影響させない
        if (turn === 0) this.messages.pop();
        throw new Error(describeError(e, this.Anthropic));
      }

      if (response.stop_reason === "refusal") {
        // 応答を履歴に残さない（同じ会話で再挑戦できるように、発話ごと取り除く）
        this.messages.splice(this.messages.length - 1 - turn * 2);
        throw new Error("この依頼は処理できませんでした（安全上の理由で応答が中断されました）。言い方を変えてお試しください。");
      }

      // thinking ブロックを含めて応答全体をそのまま履歴に積む
      this.messages.push({ role: "assistant", content: response.content });
      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) hooks.onText?.(block.text);
      }

      if (response.stop_reason !== "tool_use") {
        if (response.stop_reason === "max_tokens") hooks.onText?.("（応答が長すぎて途中で切れました）");
        return;
      }

      const results = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const input = typeof block.input === "string" ? safeParse(block.input) : block.input;
        const r = input == null ? { ok: false, message: "入力 JSON を解釈できませんでした。" } : runAction(this.ctx, block.name, input);
        hooks.onTool?.(block.name, input, r);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: r.data !== undefined ? `${r.message}\n${JSON.stringify(r.data)}` : r.message,
          ...(r.ok ? {} : { is_error: true }),
        });
      }
      // 並列ツール呼び出しの結果は 1 つの user メッセージにまとめて返す
      this.messages.push({ role: "user", content: results });
    }
    hooks.onText?.("（ツール呼び出しが多すぎるため中断しました）");
  }
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function describeError(e, Anthropic) {
  if (Anthropic) {
    if (e instanceof Anthropic.AuthenticationError) return "API キーが無効です。設定を確認してください。";
    if (e instanceof Anthropic.PermissionDeniedError) return "この API キーではこのモデルを使えません。";
    if (e instanceof Anthropic.NotFoundError) return "モデルが見つかりません。設定でモデルを変えてください。";
    if (e instanceof Anthropic.RateLimitError) return "レート制限に達しました。少し待ってから再試行してください。";
    if (e instanceof Anthropic.BadRequestError) return `リクエストエラー: ${e.message}`;
    if (e instanceof Anthropic.APIConnectionError) return "Anthropic API に接続できませんでした。ネットワークを確認してください。";
    if (e instanceof Anthropic.APIError) return `API エラー (${e.status ?? "?"}): ${e.message}`;
  }
  return `読み込みエラー: ${e.message}`;
}
