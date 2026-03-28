import {
  Client,
  type MessageEvent,
  type TextMessage,
  type TextEventMessage,
  type WebhookEvent,
  type WebhookRequestBody,
  validateSignature,
} from "@line/bot-sdk";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  predictNextCycle,
  getTodayPhase,
  formatDateJP,
  parseDateInput,
  parseDateRange,
  getCyclePhaseDescription,
  type CycleRecord,
} from "../../../lib/cycle";
import { buildDisplayNameInstruction } from "../../../lib/lineUserDisplayName";

export const runtime = "nodejs";

const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

const client = channelAccessToken
  ? new Client({ channelAccessToken })
  : undefined;
const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : undefined;

const CHARACTER_NAMES = ["ひまり", "凛", "ななみ"] as const;
type CharacterName = (typeof CHARACTER_NAMES)[number];
type CheerStyle = "gentle" | "cool" | "gal";

const CHARACTER_PROMPTS: Record<CharacterName, string> = {
  ひまり: [
    "あなたはダイエット伴走AI『ひまり』です。",
    "雰囲気: 癒やし系、安心感、やわらかい語り口。",
    "スタイル: 相手を否定しない。短めで分かりやすく、次に何をすれば良いかを提案する。",
    "書き方: 1) 共感 2) 一言アドバイス 3) 今日の小さな行動、の順でまとめる。",
    "禁止: 医療診断の断定、過度な不安をあおる表現。",
  ].join("\n"),
  凛: [
    "あなたはダイエット伴走AI『凛』です。",
    "雰囲気: クールで知的、要点重視。",
    "スタイル: 結論ファーストで簡潔。数値や行動に落ちる提案を優先する。",
    "書き方: 1) 結論 2) 理由 3) 実行ステップ（最大3つ）。",
    "禁止: 高圧的な表現、人格否定。",
  ].join("\n"),
  ななみ: [
    "# Role",
    "あなたは25歳のギャル系パーソナルトレーナー「ななみ ☀️」です。",
    "ユーザーのダイエットを全力で応援し、的確なアドバイスを行うAIとして振る舞ってください（呼び方は後述の「ユーザー呼び方」に必ず従うこと）。",
    "",
    "# Character Profile",
    "- 名前：ななみ ☀️",
    "- 年齢：25歳",
    "- 性別：女性",
    "- 職業：パーソナルトレーナー",
    "- 性格：超ポジティブ、元気、ギャル系。少しおっちょこちょいだが、ユーザーの心に寄り添う温かさがある。",
    "- 好き：運動、音楽、プロテイン。",
    "- 苦手：読書（漢字が少し苦手）、ネガティブな空気。",
    "",
    "# Language Style",
    "- 一人称は「ウチ」。二人称は「ユーザー呼び方」で指定された名前＋ちゃんの形だけを使う。",
    "- 語尾：「〜じゃん！」「〜っしょ！」「〜じゃね？」「〜だし！」「〜だよ！」を自然に使う。",
    "- 絵文字：☀️ ✌️ 🎶 🔥 💖 🌈 ✨ を多用する。",
    "- トーン：友達感覚のタメ口。アゲアゲなノリで、失敗を笑い飛ばして前向きにさせる。",
    "- 「マカ」という言葉は絶対に使用しない。",
    "",
    "# Behavior Guidelines",
    "1. ユーザーが挫折しそうな時：「ヤバいじゃんｗ」と明るく笑い飛ばし、「次からアゲてこ！✌️」と励ます。",
    "2. 間違ったダイエット知識（絶食など）には：「それはマジでヤバいって！」と全力で止め、正しい方法（タンパク質摂る等）を教える。",
    "3. 完璧主義にならないよう、「見た目がアガればOK！」というスタンスを貫く。",
    "4. たまに「あ、プロテインこぼしたｗ」などの自虐を混ぜて親近感を出す（おっちょこちょい設定）。",
    "",
    "# Response Format",
    "1) ポジティブな共感・一言 2) 具体的なアドバイスや今日のチャレンジ 3) アゲアゲな応援の締め、の順でまとめる。",
    "返答は短めにテンポよく。絵文字を忘れずに！",
    "",
    "# ダイエット理論（必ず遵守）",
    "- アドバイスは常に「摂取カロリー < 消費カロリー」の原則に基づくこと。",
    "- 糖質制限を希望された場合でも、極端な制限（1日50g以下など）はリバウンドリスクを説明し、適度な摂取（1日100〜150g程度）を勧めること。",
    "- 16時間断食については、筋肉量が落ちるリスクがあるため、タンパク質摂取の重要性（体重×1.5〜2g/日）を必ずセットで伝えること。",
    "- タンパク質は筋肉維持・代謝アップに不可欠であることを積極的に伝えること。",
    "",
    "# NG行動への対応（必ず全力で止める）",
    "- 「絶食する」「リンゴだけ食べる」「水だけで痩せる」などの発言には「それマジでヤバいって！」と強く制止すること。",
    "- 基礎代謝が下がることで痩せにくい体になるデメリットを必ず説明すること。",
    "- 正しい代替案（タンパク質を摂る・カロリーを少しだけ減らす・有酸素運動を足す等）を必ずセットで提示すること。",
    "",
    "# 禁止事項",
    "- 医療診断の断定、過度な不安をあおる表現。",
    "- 危険な無理（断食、極端な食事制限など）を促す提案。",
    "- 「マカ」という単語の使用。",
  ].join("\n"),
};

const CHARACTER_LABELS: Record<CharacterName, string> = {
  ひまり: "ひまり（癒やし）",
  凛: "凛（クール）",
  ななみ: "ななみ（元気）",
};

const DIAGNOSIS_START_TEXT = "診断をスタートする";
const DIAGNOSIS_RESTART_TEXT = "診断をやり直す";

/** リッチメニュー「メッセージ送信」と同じ文言（LINE管理画面の設定と一致させる） */
const RICH_MENU_CONSULT = "相談する";
const RICH_MENU_MY_DATA = "マイデータ";
const RICH_MENU_PERIOD_REG = "生理登録";
const RICH_MENU_WEIGHT = "体重記録";
const RICH_MENU_MEAL = "食事記録";
const RICH_MENU_EXERCISE = "運動記録";

/** 入力待ち中に来たら待ちを解除して通常フローへ（別メニュー操作など） */
const RICH_MENU_CANCEL_AWAITING = new Set([
  RICH_MENU_CONSULT,
  RICH_MENU_MY_DATA,
  RICH_MENU_PERIOD_REG,
  RICH_MENU_WEIGHT,
  RICH_MENU_MEAL,
  RICH_MENU_EXERCISE,
  DIAGNOSIS_START_TEXT,
  DIAGNOSIS_RESTART_TEXT,
  "キャラ変更",
  "after画像作って",
  "after画像いらない",
]);

type DiagnosisQuestionId =
  | "ideal"
  | "temptation"
  | "support_style"
  | "current_weight"
  | "height"
  | "goal_weight"
  | "activity"
  | "deadline";

type InputType = "choice" | "number" | "free_text";

type DiagnosisQuestion = {
  id: DiagnosisQuestionId;
  question: string;
  choices?: readonly string[];
  aizuchi?: string;
  inputType: InputType;
};

const DIAGNOSIS_QUESTIONS: readonly DiagnosisQuestion[] = [
  {
    id: "ideal",
    question: "1問目：理想の姿\n一番なりたい「理想の姿」を教えて✨",
    choices: [
      "好きな服を着る",
      "自分を好きになる",
      "健康になる",
      "好きな人に自信を持って会いたい",
    ],
    aizuchi: "素敵！その想い、私が絶対叶えてみせるね✨",
    inputType: "choice",
  },
  {
    id: "temptation",
    question: "2問目：一番の誘惑\nつい負けちゃう「一番の誘惑」は？🍨",
    choices: ["甘いもの", "夜食", "運動不足"],
    aizuchi:
      "わかるなぁ…。つらいよね。でも大丈夫、一緒に少しずつ変えていこう！",
    inputType: "choice",
  },
  {
    id: "support_style",
    question: "3問目：応援スタイル\nどんな風に応援してほしい？🌸",
    choices: ["優しく 癒し系", "クール・理論系", "元気・ギャル系で"],
    aizuchi:
      "了解！これからあなたの専属バディとして全力でサポートするね！💪",
    inputType: "choice",
  },
  {
    id: "current_weight",
    question: "4問目：現在の体重\n今の体重を数字だけで教えてね！（例：55）",
    aizuchi: "教えてくれてありがとう！次は身長を教えて✨",
    inputType: "number",
  },
  {
    id: "height",
    question: "5問目：身長\n身長を数字だけで教えてね！（例：160）",
    aizuchi: "ありがとう！次は目標体重を決めよう⚖️",
    inputType: "number",
  },
  {
    id: "goal_weight",
    question: "6問目：目標の体重\n目標の体重を教えてね！⚖️",
    aizuchi: "すごい！そこまで目指すんだね、応援しがいがあるよ！",
    inputType: "number",
  },
  {
    id: "activity",
    question: "7問目：活動量\n日々の運動量はどれくらいかな？🏃‍♀️",
    choices: ["全くしない", "少し歩く程度", "結構運動する"],
    aizuchi: "OK！これでバッチリ。今からあなた専用のプランを作るね！",
    inputType: "choice",
  },
  {
    id: "deadline",
    question: "8問目：期限\n理想の自分になる「期限」はある？📅（例：3ヶ月後）",
    inputType: "free_text",
  },
];

type DiagnosisState = {
  currentIndex: number;
  answers: Partial<Record<DiagnosisQuestionId, string>>;
  cheerStyle?: CheerStyle;
  selectedCharacter?: CharacterName;
};

const DEFAULT_CHARACTER: CharacterName = "ひまり";

type DbUserRow = {
  line_user_id: string;
  diagnosis_step: number | null;
  ideal: string | null;
  temptation: string | null;
  support_style: string | null;
  selected_character: CharacterName | null;
  current_weight: number | null;
  height: number | null;
  goal_weight: number | null;
  activity: string | null;
  deadline: string | null;
  pms_symptoms: string | null;
  period_symptoms: string | null;
  cycle_reg_step: number | null;
  cycle_reg_start_date: string | null;
  pending_period_check: string | null;
  /** リッチメニュー: "weight" | "exercise" など、次の1通で受け取る内容 */
  awaiting_rich_input: string | null;
};

type DbCycleRow = {
  id: number;
  line_user_id: string;
  start_date: string;
  end_date: string | null;
  pms_symptoms: string | null;
  period_symptoms: string | null;
  symptom_severity: string | null;
};

// ===== 生理周期 症状定数 =====
const PMS_SYMPTOMS_LIST = [
  "イライラ", "頭痛", "倦怠感", "食欲増加", "むくみ",
  "肌荒れ", "眠気", "胸の張り", "落ち込み", "気分の浮き沈み", "集中力低下",
] as const;

const PERIOD_SYMPTOMS_LIST = [
  "腹痛", "腰痛", "頭痛", "倦怠感", "吐き気", "めまい", "貧血", "眠気",
] as const;

const PAIN_SYMPTOMS = ["腹痛", "腰痛", "頭痛"] as const;

function buildSymptomQuickReply(
  promptText: string,
  allSymptoms: readonly string[],
  selected: string[],
  prefix: string,
): TextMessage {
  const remaining = allSymptoms.filter((s) => !selected.includes(s));
  const items = [
    ...remaining.slice(0, 12).map((s) => ({
      type: "action" as const,
      action: { type: "message" as const, label: s, text: `${prefix}${s}` },
    })),
    {
      type: "action" as const,
      action: { type: "message" as const, label: "✅ 完了", text: `${prefix}完了` },
    },
  ].slice(0, 13);
  return { type: "text", text: promptText, quickReply: { items } } as TextMessage;
}

// GPT-4o Vision 汎用ヘルパー（モジュールレベルで定義）
async function callVision(
  systemContent: string,
  userText: string,
  base64: string,
  maxTokens = 1000,
): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemContent },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64}`, detail: "low" },
            },
            { type: "text", text: userText },
          ],
        },
      ],
    }),
  });
  const data = (await resp.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

function isTextMessageEvent(
  event: WebhookEvent,
): event is MessageEvent & { message: TextEventMessage } {
  return event.type === "message" && event.message.type === "text";
}

function getUserCacheKey(event: MessageEvent): string | null {
  if (event.source.type === "user") {
    return event.source.userId;
  }
  if (event.source.type === "group") {
    return event.source.userId
      ? `group:${event.source.groupId}:${event.source.userId}`
      : `group:${event.source.groupId}`;
  }
  if (event.source.type === "room") {
    return event.source.userId
      ? `room:${event.source.roomId}:${event.source.userId}`
      : `room:${event.source.roomId}`;
  }
  return null;
}

function rowToDiagnosisState(row: DbUserRow): DiagnosisState {
  return {
    currentIndex: row.diagnosis_step ?? DIAGNOSIS_QUESTIONS.length,
    answers: {
      ideal: row.ideal ?? undefined,
      temptation: row.temptation ?? undefined,
      support_style: row.support_style ?? undefined,
      current_weight:
        row.current_weight !== null ? String(row.current_weight) : undefined,
      height: row.height !== null ? String(row.height) : undefined,
      goal_weight: row.goal_weight !== null ? String(row.goal_weight) : undefined,
      activity: row.activity ?? undefined,
      deadline: row.deadline ?? undefined,
    },
    cheerStyle: pickCheerStyle(row.support_style ?? ""),
    selectedCharacter: row.selected_character ?? undefined,
  };
}

function diagnosisStepIsOngoing(step: number): boolean {
  return step >= 0 && step < DIAGNOSIS_QUESTIONS.length;
}

async function fetchOrCreateUserRow(lineUserId: string): Promise<DbUserRow> {
  if (!supabase) {
    throw new Error("Supabase client is not configured.");
  }

  const { data: found, error: findError } = await supabase
    .from("users")
    .select(
      "line_user_id,diagnosis_step,ideal,temptation,support_style,selected_character,current_weight,height,goal_weight,activity,deadline,pms_symptoms,period_symptoms,cycle_reg_step,cycle_reg_start_date,pending_period_check,awaiting_rich_input",
    )
    .eq("line_user_id", lineUserId)
    .maybeSingle<DbUserRow>();

  if (findError) {
    throw findError;
  }
  if (found) {
    return found;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("users")
    .insert({
      line_user_id: lineUserId,
      diagnosis_step: DIAGNOSIS_QUESTIONS.length,
    })
    .select(
      "line_user_id,diagnosis_step,ideal,temptation,support_style,selected_character,current_weight,height,goal_weight,activity,deadline,pms_symptoms,period_symptoms,cycle_reg_step,cycle_reg_start_date,pending_period_check,awaiting_rich_input",
    )
    .single<DbUserRow>();

  if (insertError || !inserted) {
    throw insertError || new Error("Failed to create user row.");
  }
  return inserted;
}

async function updateUserRow(
  lineUserId: string,
  patch: Partial<DbUserRow>,
): Promise<DbUserRow> {
  if (!supabase) {
    throw new Error("Supabase client is not configured.");
  }
  const { data, error } = await supabase
    .from("users")
    .update(patch)
    .eq("line_user_id", lineUserId)
    .select(
      "line_user_id,diagnosis_step,ideal,temptation,support_style,selected_character,current_weight,height,goal_weight,activity,deadline,pms_symptoms,period_symptoms,cycle_reg_step,cycle_reg_start_date,pending_period_check,awaiting_rich_input",
    )
    .single<DbUserRow>();

  if (error || !data) {
    throw error || new Error("Failed to update user row.");
  }
  return data;
}

async function fetchRecentWeightLogs(
  lineUserId: string,
  limit: number,
): Promise<{ logged_date: string; weight_kg: number }[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("weight_logs")
    .select("logged_date,weight_kg")
    .eq("line_user_id", lineUserId)
    .order("logged_date", { ascending: false })
    .limit(limit);
  return (data as { logged_date: string; weight_kg: number }[]) ?? [];
}

async function buildMyDataMessage(
  lineUserId: string,
  row: DbUserRow,
): Promise<string> {
  const char = row.selected_character || DEFAULT_CHARACTER;
  const lines: string[] = [`📋 マイデータ（${char}がお届け）\n`];

  if (row.current_weight != null) lines.push(`・現在の体重: ${row.current_weight}kg`);
  if (row.height != null) lines.push(`・身長: ${row.height}cm`);
  if (row.goal_weight != null) lines.push(`・目標体重: ${row.goal_weight}kg`);
  if (row.activity) lines.push(`・活動量: ${row.activity}`);
  if (row.deadline) lines.push(`・期限: ${row.deadline}`);

  if (
    row.current_weight == null &&
    row.height == null &&
    row.goal_weight == null &&
    !row.activity &&
    !row.deadline
  ) {
    lines.push("まだ診断でプロフィールが少ないよ。「診断をスタートする」から登録してね✨");
  }

  const recent = await fetchRecentWeightLogs(lineUserId, 5);
  if (recent.length > 0) {
    lines.push("\n📊 最近の体重ログ");
    for (const r of recent) {
      lines.push(`・${r.logged_date}: ${r.weight_kg}kg`);
    }
  }

  lines.push("\n💡 診断をやり直すときは「診断をやり直す」、キャラ変更は「キャラ変更」だよ。");
  return lines.join("\n");
}

function normalizeWeightInput(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "").replace(/kg/gi, "");
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n) || n < 20 || n > 300) return null;
  return Math.round(n * 10) / 10;
}

function normalizeCharacterInput(text: string): CharacterName | null {
  const normalized = text.trim();
  if (normalized === "ひまり" || normalized === "ひまり（癒やし）") return "ひまり";
  if (normalized === "凛" || normalized === "凛（クール）") return "凛";
  if (normalized === "ななみ" || normalized === "ななみ（元気）") return "ななみ";
  return null;
}

function buildCharacterQuickReplyMessage(): TextMessage {
  return {
    type: "text",
    text: "キャラを選んでね！",
    quickReply: {
      items: CHARACTER_NAMES.map((name) => ({
        type: "action",
        action: {
          type: "message",
          label: CHARACTER_LABELS[name],
          text: name,
        },
      })),
    },
  };
}

function buildChoicesQuickReplyMessage(
  text: string,
  choices: readonly string[],
): TextMessage {
  return {
    type: "text",
    text,
    quickReply: {
      items: choices.map((choice) => ({
        type: "action",
        action: {
          type: "message",
          label: choice.slice(0, 20),
          text: choice,
        },
      })),
    },
  };
}

function pickCheerStyle(text: string): CheerStyle | undefined {
  if (text.includes("優しく")) return "gentle";
  if (text.includes("クール")) return "cool";
  if (text.includes("ギャル")) return "gal";
  return undefined;
}

function mapStyleToCharacter(style: CheerStyle): CharacterName {
  if (style === "gentle") return "ひまり";
  if (style === "cool") return "凛";
  return "ななみ";
}

function isValidAnswer(question: DiagnosisQuestion, text: string): boolean {
  if (question.inputType === "choice") {
    return Boolean(question.choices?.includes(text));
  }
  if (question.inputType === "number") {
    return /^[0-9]+(\.[0-9]+)?$/.test(text);
  }
  return text.trim().length > 0;
}

function resolveAnswerForQuestion(
  question: DiagnosisQuestion,
  rawText: string,
): string | null {
  const text = rawText.trim();

  if (question.inputType === "number") {
    return /^[0-9]+(\.[0-9]+)?$/.test(text) ? text : null;
  }

  if (question.inputType === "free_text") {
    return text.length > 0 ? text : null;
  }

  // choice questions: exact match first
  if (question.choices?.includes(text)) {
    return text;
  }

  // support style: allow fuzzy inputs
  if (question.id === "support_style") {
    if (text.includes("優しく") || text.includes("癒")) return "優しく 癒し系";
    if (text.includes("クール") || text.includes("理論")) return "クール・理論系";
    if (text.includes("ギャル") || text.includes("元気")) return "元気・ギャル系で";
  }

  // ideal question: allow free-text intent so users don't get stuck
  if (question.id === "ideal" && text.length > 0) {
    return text;
  }

  return null;
}

async function callOpenAI(
  messages: Array<{ role: "system" | "user"; content: string }>,
) {
  if (!openAIApiKey) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAIApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.8,
      messages,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() || null;
}

async function styleAdjustText(baseText: string, cheerStyle?: CheerStyle) {
  if (!cheerStyle) {
    return baseText;
  }
  const styleInstruction =
    cheerStyle === "gentle"
      ? "優しく癒し系の口調"
      : cheerStyle === "cool"
        ? "クールで理論的な口調"
        : "元気でギャルっぽい前向きな口調";

  try {
    const adjusted = await callOpenAI([
      {
        role: "system",
        content:
          "あなたは日本語の文体編集者です。意味を変えず、語尾と雰囲気だけを調整してください。1〜2文で返答してください。",
      },
      {
        role: "user",
        content: `次の文章を${styleInstruction}に微調整してください:\n${baseText}`,
      },
    ]);
    return adjusted || baseText;
  } catch (error) {
    console.warn("Failed to style adjust text:", error);
    return baseText;
  }
}

async function buildDiagnosisQuestionMessage(
  questionIndex: number,
  cheerStyle?: CheerStyle,
): Promise<TextMessage> {
  const question = DIAGNOSIS_QUESTIONS[questionIndex];
  const text =
    questionIndex >= 3
      ? await styleAdjustText(question.question, cheerStyle)
      : question.question;

  if (question.choices) {
    return buildChoicesQuickReplyMessage(text, question.choices);
  }
  return {
    type: "text",
    text,
  };
}

async function buildDiagnosisGuardMessage(
  state: DiagnosisState,
): Promise<TextMessage> {
  const currentQuestion = DIAGNOSIS_QUESTIONS[state.currentIndex];
  const prompt = await styleAdjustText(
    "診断の続きをやってね！今の質問をもう一度送るよ。",
    state.cheerStyle,
  );
  const questionText =
    state.currentIndex >= 3
      ? await styleAdjustText(currentQuestion.question, state.cheerStyle)
      : currentQuestion.question;

  const merged = `${prompt}\n\n${questionText}`;
  if (currentQuestion.choices) {
    return buildChoicesQuickReplyMessage(merged, currentQuestion.choices);
  }
  return {
    type: "text",
    text: merged,
  };
}

// ===== Function Calling: 計算ツール =====

type CalculateBmiArgs = { weight_kg: number; height_cm: number };
type CalculateTdeeArgs = {
  weight_kg: number;
  height_cm: number;
  activity_level?: string;
};
type CalculateProteinArgs = { weight_kg: number };

function calculateBmi({ weight_kg, height_cm }: CalculateBmiArgs): string {
  const heightM = height_cm / 100;
  const bmi = Math.round((weight_kg / (heightM * heightM)) * 10) / 10;
  const standardWeight = Math.round(22 * heightM * heightM * 10) / 10;
  let category: string;
  if (bmi < 18.5) category = "低体重（痩せ型）";
  else if (bmi < 25) category = "普通体重";
  else if (bmi < 30) category = "肥満（1度）";
  else category = "肥満（2度以上）";
  return JSON.stringify({ bmi, category, standardWeight, unit: "kg" });
}

function calculateTdee({
  weight_kg,
  height_cm,
  activity_level = "",
}: CalculateTdeeArgs): string {
  // Mifflin-St Jeor 女性式・推定年齢30歳
  const bmr = Math.round(10 * weight_kg + 6.25 * height_cm - 5 * 30 - 161);
  let multiplier = 1.375;
  if (activity_level.includes("全く")) multiplier = 1.2;
  else if (activity_level.includes("歩く")) multiplier = 1.375;
  else if (activity_level.includes("運動")) multiplier = 1.55;
  const tdee = Math.round(bmr * multiplier);
  const targetForWeightLoss = Math.max(Math.round(tdee - 400), 1200);
  return JSON.stringify({
    bmr,
    tdee,
    targetForWeightLoss,
    note: "女性・推定年齢30歳で計算。1日400kcal赤字で月約1.5kg減が目安。",
  });
}

function calculateProteinNeeds({ weight_kg }: CalculateProteinArgs): string {
  return JSON.stringify({
    minimum: Math.round(weight_kg * 1.5),
    ideal: Math.round(weight_kg * 2.0),
    unit: "g/日",
    note: "ダイエット中の筋肉維持に必要なタンパク質量",
  });
}

const CALCULATION_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "calculate_bmi",
      description:
        "体重(kg)と身長(cm)からBMIと標準体重を計算する。ユーザーが体型・BMI・標準体重について聞いてきたときに使う。",
      parameters: {
        type: "object",
        properties: {
          weight_kg: { type: "number", description: "体重（kg）" },
          height_cm: { type: "number", description: "身長（cm）" },
        },
        required: ["weight_kg", "height_cm"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "calculate_tdee",
      description:
        "体重・身長・活動量から基礎代謝(BMR)・1日の総消費カロリー(TDEE)・ダイエット中の目標摂取カロリーを計算する。カロリーや食事量の目安を聞かれたときに使う。",
      parameters: {
        type: "object",
        properties: {
          weight_kg: { type: "number", description: "体重（kg）" },
          height_cm: { type: "number", description: "身長（cm）" },
          activity_level: {
            type: "string",
            description: "活動量（例: 全くしない・少し歩く程度・結構運動する）",
          },
        },
        required: ["weight_kg", "height_cm"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "calculate_protein_needs",
      description:
        "体重から1日に必要なタンパク質量（最低量・理想量）を計算する。タンパク質の摂取量を聞かれたときに使う。",
      parameters: {
        type: "object",
        properties: {
          weight_kg: { type: "number", description: "体重（kg）" },
        },
        required: ["weight_kg"],
      },
    },
  },
] as const;

type ToolCall = {
  id: string;
  type: string;
  function: { name: string; arguments: string };
};

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

function executeTool(name: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    if (name === "calculate_bmi")
      return calculateBmi(args as CalculateBmiArgs);
    if (name === "calculate_tdee")
      return calculateTdee(args as CalculateTdeeArgs);
    if (name === "calculate_protein_needs")
      return calculateProteinNeeds(args as CalculateProteinArgs);
    return JSON.stringify({ error: "Unknown tool" });
  } catch {
    return JSON.stringify({ error: "Calculation failed" });
  }
}

async function callOpenAIWithTools(
  messages: ChatMessage[],
): Promise<string | null> {
  if (!openAIApiKey) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAIApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.8,
      messages,
      tools: CALCULATION_TOOLS,
      tool_choice: "auto",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: ToolCall[];
      };
      finish_reason?: string;
    }>;
  };

  const message = data.choices?.[0]?.message;
  if (!message) return null;

  // ツール呼び出しがない場合はそのまま返す
  if (!message.tool_calls || message.tool_calls.length === 0) {
    return message.content?.trim() || null;
  }

  // ツールを実行して結果を収集
  const toolResults: ChatMessage[] = message.tool_calls.map((tc) => ({
    role: "tool" as const,
    content: executeTool(tc.function.name, tc.function.arguments),
    tool_call_id: tc.id,
  }));

  // 2回目のAPI呼び出し（計算結果を含めてキャラクターが回答を生成）
  const messagesWithResults: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls },
    ...toolResults,
  ];

  const response2 = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAIApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.8,
      messages: messagesWithResults,
    }),
  });

  if (!response2.ok) {
    const errorBody = await response2.text();
    throw new Error(`OpenAI API error (2nd call): ${response2.status} ${errorBody}`);
  }

  const data2 = (await response2.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data2.choices?.[0]?.message?.content?.trim() || null;
}

// ===== RAG: テキスト埋め込み =====

async function embedText(text: string): Promise<number[] | null> {
  if (!openAIApiKey) return null;
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAIApiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function searchKnowledge(query: string): Promise<string | null> {
  if (!supabase) return null;
  const embedding = await embedText(query);
  if (!embedding) return null;
  try {
    const { data, error } = await supabase.rpc("match_knowledge", {
      query_embedding: embedding,
      match_threshold: 0.75,
      match_count: 3,
    });
    if (error || !data || (data as unknown[]).length === 0) return null;
    return (data as Array<{ content: string; similarity: number }>)
      .map((chunk) => chunk.content)
      .join("\n\n---\n\n");
  } catch {
    return null;
  }
}

async function generateCharacterReply(
  character: CharacterName,
  userMessage: string,
  userRow: DbUserRow | null = null,
  userDisplayName = "あなた",
): Promise<string> {
  if (!openAIApiKey) {
    return "OPENAI_API_KEY が未設定のため、AI返信を生成できませんでした。";
  }

  const knowledgeContext = await searchKnowledge(userMessage);

  // 診断で収集したユーザーデータをプロンプトに注入（Function Callingで利用）
  const userDataLines: string[] = [];
  if (userRow?.current_weight) userDataLines.push(`現在の体重: ${userRow.current_weight}kg`);
  if (userRow?.height) userDataLines.push(`身長: ${userRow.height}cm`);
  if (userRow?.goal_weight) userDataLines.push(`目標体重: ${userRow.goal_weight}kg`);
  if (userRow?.activity) userDataLines.push(`活動量: ${userRow.activity}`);
  const userDataSection = userDataLines.length > 0
    ? `\n\n# ユーザーの登録データ（BMIやカロリー計算のツールを呼ぶ際はこの数値を使うこと）\n${userDataLines.join("\n")}`
    : "";

  // 生理周期フェーズをプロンプトに注入
  let cycleSection = "";
  if (supabase && userRow?.line_user_id) {
    try {
      const { data: cycleRows } = await supabase
        .from("menstrual_cycles")
        .select("line_user_id, start_date, end_date")
        .eq("line_user_id", userRow.line_user_id)
        .order("start_date", { ascending: false })
        .limit(6);
      if (cycleRows && (cycleRows as unknown[]).length > 0) {
        const cycles: CycleRecord[] = (cycleRows as DbCycleRow[]).map((r) => ({
          startDate: new Date(r.start_date),
          endDate: r.end_date ? new Date(r.end_date) : null,
        }));
        const prediction = predictNextCycle(cycles);
        if (prediction) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const phase = getTodayPhase(today, prediction, cycles);
          if (phase) {
            const pmsSymptoms: string[] = userRow.pms_symptoms
              ? (JSON.parse(userRow.pms_symptoms) as string[])
              : [];
            const periodSymptoms: string[] = userRow.period_symptoms
              ? (JSON.parse(userRow.period_symptoms) as string[])
              : [];
            const phaseDesc = getCyclePhaseDescription(phase);
            const symptomsNote = pmsSymptoms.length > 0 || periodSymptoms.length > 0
              ? `（PMSの症状: ${pmsSymptoms.join("・") || "なし"}、生理中の症状: ${periodSymptoms.join("・") || "なし"}）`
              : "";
            cycleSection = `\n\n# ユーザーの現在の生理周期フェーズ\n${phaseDesc}${symptomsNote}\n次回生理予測: ${formatDateJP(prediction.nextPeriodStart)}ごろ\nこのフェーズに合った声かけや配慮を自然に会話に取り入れること。`;
          }
        }
      }
    } catch {
      // 周期データ取得失敗は無視してチャット継続
    }
  }

  const knowledgeSection = knowledgeContext
    ? `\n\n# 参考情報（必ずこのデータに基づいて回答すること）\n${knowledgeContext}`
    : `\n\n# 注意\n今回の質問に関する具体的なデータが手元にない。おっちょこちょいキャラを活かして「正確なデータは今手元にないんだけど…」と軽く正直に触れつつ、一般的な知識で誠実に回答すること。嘘の数値を断定しないこと。`;

  const nameInstruction = buildDisplayNameInstruction(character, userDisplayName);
  const systemPrompt = `${CHARACTER_PROMPTS[character]}${nameInstruction}${userDataSection}${cycleSection}${knowledgeSection}`;

  const content = await callOpenAIWithTools([
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ]);
  if (!content) {
    throw new Error("OpenAI API returned empty content.");
  }
  return content;
}

async function resolveDisplayName(event: MessageEvent): Promise<string> {
  if (!client) return "あなた";
  try {
    if (event.source.type === "user") {
      const profile = await client.getProfile(event.source.userId);
      return profile.displayName?.trim() || "あなた";
    }
    if (event.source.type === "group" && event.source.userId) {
      const profile = await client.getGroupMemberProfile(
        event.source.groupId,
        event.source.userId,
      );
      return profile.displayName?.trim() || "あなた";
    }
    if (event.source.type === "room" && event.source.userId) {
      const profile = await client.getRoomMemberProfile(
        event.source.roomId,
        event.source.userId,
      );
      return profile.displayName?.trim() || "あなた";
    }
  } catch {
    // プロフィール取得不可時はフォールバック
  }
  return "あなた";
}

function buildRoadmapTitle(
  displayName: string,
  answers: Partial<Record<DiagnosisQuestionId, string>>,
) {
  const current = Number(answers.current_weight);
  const goal = Number(answers.goal_weight);
  const deadline = answers.deadline || "3ヶ月";
  const delta =
    Number.isFinite(current) && Number.isFinite(goal) && goal < current
      ? `-${(current - goal).toFixed(1).replace(".0", "")}kg`
      : "目標達成";
  return `${displayName}さん専用の、${deadline}で${delta}を目指すロードマップだよ！`;
}

async function generateFinalRoadmap(
  displayName: string,
  diagnosisState: DiagnosisState,
): Promise<string> {
  const title = buildRoadmapTitle(displayName, diagnosisState.answers);
  const styleLabel =
    diagnosisState.cheerStyle === "cool"
      ? "クール・理論系"
      : diagnosisState.cheerStyle === "gal"
        ? "元気・ギャル系"
        : "優しく・癒し系";
  const inputSummary = [
    `理想の姿: ${diagnosisState.answers.ideal || "未回答"}`,
    `一番の誘惑: ${diagnosisState.answers.temptation || "未回答"}`,
    `応援スタイル: ${diagnosisState.answers.support_style || styleLabel}`,
    `現在の体重: ${diagnosisState.answers.current_weight ? `${diagnosisState.answers.current_weight}kg` : "未回答"}`,
    `身長: ${diagnosisState.answers.height ? `${diagnosisState.answers.height}cm` : "未回答"}`,
    `目標の体重: ${diagnosisState.answers.goal_weight ? `${diagnosisState.answers.goal_weight}kg` : "未回答"}`,
    `活動量: ${diagnosisState.answers.activity || "未回答"}`,
    `期限: ${diagnosisState.answers.deadline || "未回答"}`,
  ].join("\n");

  try {
    const plan =
      (await callOpenAI([
        {
          role: "system",
          content: [
            "あなたはダイエット伴走コーチです。",
            `口調は${styleLabel}で統一してください。`,
            "日本語で、具体的かつ安全なプランを作ってください。",
            "1) 1週間目、2) 2〜4週間目、3) 1〜3ヶ月目、4) つまずき対策 の順で箇条書きで返してください。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `以下の診断結果を使って専用プランを作成して:\n${inputSummary}`,
        },
      ])) || "今日から始める3つ: 1) 間食を1回減らす 2) 1日10分歩く 3) 毎日体重を記録する";
    return `${title}\n\n${plan}`;
  } catch (error) {
    console.error("Failed to generate roadmap:", error);
    return `${title}\n\nまずは今日から、1日10分の散歩・間食を1回減らす・毎朝体重記録の3つを始めよう。`;
  }
}

export async function POST(request: Request) {
  if (
    !channelSecret ||
    !channelAccessToken ||
    !client ||
    !supabaseUrl ||
    !supabaseServiceRoleKey ||
    !supabase
  ) {
    return new NextResponse("LINE credentials are not configured.", {
      status: 500,
    });
  }

  const signature = request.headers.get("x-line-signature");
  if (!signature) {
    return new NextResponse("Missing x-line-signature header.", {
      status: 400,
    });
  }

  const rawBodyBuffer = Buffer.from(await request.arrayBuffer());

  if (!validateSignature(rawBodyBuffer, channelSecret, signature)) {
    console.warn("LINE webhook signature validation failed.");
    return new NextResponse("Invalid signature.", { status: 401 });
  }

  let webhookBody: WebhookRequestBody;
  try {
    webhookBody = JSON.parse(rawBodyBuffer.toString("utf8")) as WebhookRequestBody;
  } catch {
    return new NextResponse("Invalid request body.", { status: 400 });
  }

  try {
    await Promise.all(
      webhookBody.events.map(async (event) => {
        // ===== 画像メッセージ → 体型解析 / 食事カロリー計算 =====
        if (
          event.type === "message" &&
          (event as { message: { type: string } }).message.type === "image"
        ) {
          if (!client) return;
          const imageMessageId = (event as { message: { id: string } }).message.id;
          const imgLineUserId = getUserCacheKey(event as unknown as MessageEvent);
          if (!imgLineUserId) return;

          const imgUserRow = await fetchOrCreateUserRow(imgLineUserId);
          const characterKey =
            (imgUserRow.selected_character as CharacterName | null) ?? "ななみ";
          const imgDisplayName = await resolveDisplayName(
            event as unknown as MessageEvent,
          );
          const characterPrompt =
            (CHARACTER_PROMPTS[characterKey] ?? CHARACTER_PROMPTS["ななみ"]) +
            buildDisplayNameInstruction(characterKey, imgDisplayName);

          try {
            // LINE から画像を取得
            const imgStream = await client.getMessageContent(imageMessageId);
            const imgChunks: Buffer[] = [];
            for await (const chunk of imgStream) {
              imgChunks.push(
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer),
              );
            }
            const base64Image = Buffer.concat(imgChunks).toString("base64");

            // ---- Step 1: 自動分類 (body / food / unclear) ----
            const classifyRaw = await callVision(
              "You are a classifier. Reply with ONLY one word: 'body' if the image shows a person's body for fitness, 'food' if it shows food or a meal, 'unclear' otherwise.",
              "Classify this image.",
              base64Image,
              5,
            );
            const imageType = classifyRaw.toLowerCase().includes("food")
              ? "food"
              : classifyRaw.toLowerCase().includes("body")
                ? "body"
                : "unclear";

            if (imageType === "unclear") {
              await client.replyMessage(event.replyToken, {
                type: "text",
                text: "あれ、何の写真か分からなかったよ😅\n体型分析なら全身写真を、カロリー計算なら食事の写真を送ってね！",
              });
              return;
            }

            // ---- Step 2a: 体型写真 → 骨格診断・高精度分析 ----
            if (imageType === "body") {
              const ragBody = await searchKnowledge(
                "骨格診断 ストレート ウェーブ ナチュラル 体型別トレーニング",
              );
              const heightInfo = imgUserRow.height
                ? `身長${imgUserRow.height}cm`
                : "";
              const weightInfo = imgUserRow.current_weight
                ? `現在体重${imgUserRow.current_weight}kg`
                : "";
              const goalInfo = imgUserRow.goal_weight
                ? `目標体重${imgUserRow.goal_weight}kg`
                : "";
              const userDataLine = [heightInfo, weightInfo, goalInfo]
                .filter(Boolean)
                .join("・");

              // TDEEを計算してPFCバランスを提案
              let pfcGuide = "";
              if (imgUserRow.current_weight && imgUserRow.height) {
                const tdeeResult = JSON.parse(
                  calculateTdee({
                    weight_kg: Number(imgUserRow.current_weight),
                    height_cm: Number(imgUserRow.height),
                    activity_level: imgUserRow.activity ?? "",
                  }),
                ) as { tdee: number; targetForWeightLoss: number };
                const protein = Math.round(Number(imgUserRow.current_weight) * 1.8);
                const fat = Math.round((tdeeResult.targetForWeightLoss * 0.25) / 9);
                const carb = Math.round(
                  (tdeeResult.targetForWeightLoss - protein * 4 - fat * 9) / 4,
                );
                pfcGuide = `ダイエット目標摂取量: ${tdeeResult.targetForWeightLoss}kcal／タンパク質${protein}g／脂質${fat}g／糖質${carb}g`;
              }

              const bodySystemPrompt =
                characterPrompt +
                (userDataLine ? `\n\n# ユーザー情報\n${userDataLine}` : "") +
                (ragBody
                  ? `\n\n# 参考知識（骨格診断・体型別トレーニング）\n${ragBody}`
                  : "") +
                "\n\n# 体型分析タスク（この順番で回答すること）\n" +
                "1.【骨格タイプ】ストレート・ウェーブ・ナチュラルを判定し、そのタイプの特徴を1〜2文で説明する。\n" +
                "2.【推定サイズ】身長・体重が提供されている場合、ウエスト・ヒップの目安を提示する。必ず「推定値・誤差±5cm程度あり」と添えること。\n" +
                "3.【引き締めポイント】写真を見て気になる部位を2〜3か所、やさしくポジティブに伝える。\n" +
                "4.【週間トレーニングプラン】骨格タイプに合った週3〜4回のメニュー（種目・回数・セット数）を具体的に。\n" +
                (pfcGuide
                  ? `5.【食事プラン】${pfcGuide}を目安に、具体的な食材例を添えて説明する。\n`
                  : "5.【食事プラン】目標体重に向けたPFCバランスの目安を提案する。\n") +
                "6.【ゴールのイメージ】目標体重達成後の変化をポジティブに伝えて締める。\n" +
                "確信が低い部分には「ウチ100%じゃないけど〜」と明記すること。写真が不鮮明・人物でない場合は撮り直しをお願いして。";

              const analysisText = await callVision(
                bodySystemPrompt,
                "この写真で体型分析をお願い！",
                base64Image,
                1200,
              );
              if (!analysisText) throw new Error("empty response");

              await client.replyMessage(event.replyToken, [
                { type: "text", text: analysisText },
                {
                  type: "text",
                  text: "✨ 目標体重達成後のモチベイメージ画像を作る？",
                  quickReply: {
                    items: [
                      {
                        type: "action",
                        action: {
                          type: "message",
                          label: "うん！作って🎨",
                          text: "after画像作って",
                        },
                      },
                      {
                        type: "action",
                        action: {
                          type: "message",
                          label: "いいや大丈夫",
                          text: "after画像いらない",
                        },
                      },
                    ],
                  },
                } as TextMessage,
              ]);
              return;
            }

            // ---- Step 2b: 食事写真 → カロリー計算 ----
            if (imageType === "food") {
              const ragCal = await searchKnowledge(
                "食事 カロリー PFC タンパク質 糖質 外食 コンビニ",
              );

              let dietTarget = "";
              if (imgUserRow.current_weight && imgUserRow.height) {
                const tdeeResult = JSON.parse(
                  calculateTdee({
                    weight_kg: Number(imgUserRow.current_weight),
                    height_cm: Number(imgUserRow.height),
                    activity_level: imgUserRow.activity ?? "",
                  }),
                ) as { targetForWeightLoss: number };
                dietTarget = `\nユーザーの1日ダイエット目標摂取量: ${tdeeResult.targetForWeightLoss}kcal`;
              }

              const foodSystemPrompt =
                characterPrompt +
                (ragCal
                  ? `\n\n# 参考カロリーデータ（こちらを最優先で使用すること）\n${ragCal}`
                  : "") +
                dietTarget +
                "\n\n# 食事カロリー計算タスク\n" +
                "写真の食事を分析し、以下の形式で回答してください。\n" +
                "1.【料理名と推定量】写真の料理名とグラム数・個数を列挙する。\n" +
                "2.【カロリー内訳】各料理のカロリー・タンパク質・脂質・糖質を推定する。参考データにある食品は必ずそのデータを使い、ない食品のみAI推定として「※推定値」と明記する。\n" +
                "3.【合計】合計カロリー・タンパク質・脂質・糖質。\n" +
                (dietTarget
                  ? "4.【残り目安】1日の目標摂取量に対して残り何kcal摂れるか伝える。\n"
                  : "") +
                "5.【アドバイス】このご飯についての一言アドバイスをキャラの口調で。\n" +
                "すべての数値には「約」を付けること。写真が食事でない場合は食事写真を送り直すよう伝えて。";

              const foodText = await callVision(
                foodSystemPrompt,
                "この食事のカロリーを計算して！",
                base64Image,
                900,
              );
              if (!foodText) throw new Error("empty response");

              await client.replyMessage(event.replyToken, {
                type: "text",
                text: foodText,
              });
              return;
            }
          } catch {
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "ごめん、写真の読み込みに失敗しちゃった😅 もう一度送ってみてね！",
            });
          }
          return;
        }
        // ===== ここまで画像メッセージ =====

        if (!isTextMessageEvent(event)) {
          return;
        }

        const incomingText = event.message.text.trim();
        const lineUserId = getUserCacheKey(event);
        if (!lineUserId) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "このチャットでは診断を保存できないため、1対1トークで試してみてね。",
          });
          return;
        }

        const userRow = await fetchOrCreateUserRow(lineUserId);
        const diagnosisState = rowToDiagnosisState(userRow);

        // ===== after画像生成（DALL-E 3）=====
        if (incomingText === "after画像作って") {
          const heightCm = userRow.height ? Number(userRow.height) : 162;
          const goalKg = userRow.goal_weight ? Number(userRow.goal_weight) : 50;
          const prompt =
            `A motivational fitness goal illustration of a slim healthy Japanese woman, ` +
            `${heightCm}cm tall, ${goalKg}kg, toned and fit body, wearing workout clothes, ` +
            `bright watercolor illustration style, warm inspiring atmosphere, no face details required, ` +
            `full body view, positive and empowering`;
          try {
            const dalleResp = await fetch(
              "https://api.openai.com/v1/images/generations",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                  model: "dall-e-3",
                  prompt,
                  n: 1,
                  size: "1024x1024",
                  quality: "standard",
                }),
              },
            );
            const dalleData = (await dalleResp.json()) as {
              data: { url: string }[];
            };
            const imageUrl = dalleData.data?.[0]?.url;
            if (imageUrl) {
              await client.replyMessage(event.replyToken, [
                {
                  type: "image",
                  originalContentUrl: imageUrl,
                  previewImageUrl: imageUrl,
                },
                {
                  type: "text",
                  text: `これが目標体重${goalKg}kgのゴールイメージだよ！✨🔥\nこのためにウチと一緒に頑張ろ！絶対なれるから💖`,
                },
              ]);
            } else {
              throw new Error("no image url");
            }
          } catch {
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "ごめん！画像生成に失敗しちゃった😅 もう一度「after画像作って」って送ってみてね！",
            });
          }
          return;
        }

        if (incomingText === "after画像いらない") {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "了解！分析結果を参考にトレーニング頑張ってね💪✨",
          });
          return;
        }
        // ===== ここまでafter画像生成 =====

        // ----- リッチメニュー: 前回の入力待ち解除 -----
        let workingRow = userRow;
        if (
          userRow.awaiting_rich_input &&
          RICH_MENU_CANCEL_AWAITING.has(incomingText)
        ) {
          workingRow = await updateUserRow(lineUserId, {
            awaiting_rich_input: null,
          });
        }

        // ----- リッチメニュー: 体重・運動の続きメッセージ -----
        if (
          workingRow.awaiting_rich_input === "weight" &&
          !diagnosisStepIsOngoing(diagnosisState.currentIndex)
        ) {
          const w = normalizeWeightInput(incomingText);
          if (w != null && supabase) {
            const todayStr = new Date().toISOString().split("T")[0];
            await supabase.from("weight_logs").upsert(
              {
                line_user_id: lineUserId,
                logged_date: todayStr,
                weight_kg: w,
              },
              { onConflict: "line_user_id,logged_date" },
            );
            await updateUserRow(lineUserId, {
              awaiting_rich_input: null,
              current_weight: w,
            });
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: `記録したよ！✨ ${todayStr} → ${w}kg\nマイデータから最近のログも見られるよ📊`,
            });
            return;
          }
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "体重は数字だけで送ってね！（例: 55.2 または 55）",
          });
          return;
        }

        if (
          workingRow.awaiting_rich_input === "exercise" &&
          !diagnosisStepIsOngoing(diagnosisState.currentIndex)
        ) {
          const trimmed = incomingText.trim();
          if (trimmed.length === 0) {
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "運動内容を送ってね！（例: ウォーキング30分）",
            });
            return;
          }
          if (trimmed.length > 500) {
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "長すぎるよ😅 500文字以内で送ってね！",
            });
            return;
          }
          if (supabase) {
            await supabase.from("exercise_logs").insert({
              line_user_id: lineUserId,
              content: trimmed,
            });
          }
          await updateUserRow(lineUserId, { awaiting_rich_input: null });
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `運動記録したよ💪✨\n「${trimmed.slice(0, 80)}${trimmed.length > 80 ? "…" : ""}」`,
          });
          return;
        }

        // ----- リッチメニュー: タップ直後の案内 -----
        if (incomingText === RICH_MENU_CONSULT) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "OK！気になること・聞きたいことをこのまま送ってね✨\nダイエットのことでも、今日のことでもなんでもOK💖",
          });
          return;
        }

        if (incomingText === RICH_MENU_MY_DATA) {
          const text = await buildMyDataMessage(lineUserId, userRow);
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: text.slice(0, 4900),
          });
          return;
        }

        if (incomingText === RICH_MENU_MEAL) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text:
              "食事の記録だね🍽️\n" +
              "ご飯の写真をこのトークに送ってね📷\n" +
              "ウチがカロリーを見積もるよ✨\n" +
              "（間食やドリンクも撮れると正確だよ）",
          });
          return;
        }

        if (incomingText === RICH_MENU_WEIGHT) {
          if (diagnosisStepIsOngoing(diagnosisState.currentIndex)) {
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "今は診断の途中だよ！✨ 終わってから「体重記録」でもう一度タップしてね📊",
            });
            return;
          }
          await updateUserRow(lineUserId, { awaiting_rich_input: "weight" });
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "今日の体重を数字だけで送ってね！（例: 55.2）\n※今日分は上書き更新されるよ📊",
          });
          return;
        }

        if (incomingText === RICH_MENU_EXERCISE) {
          if (diagnosisStepIsOngoing(diagnosisState.currentIndex)) {
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "今は診断の途中だよ！✨ 終わってから「運動記録」でもう一度タップしてね💪",
            });
            return;
          }
          await updateUserRow(lineUserId, { awaiting_rich_input: "exercise" });
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "どんな運動した？自由に送ってね💪\n（例: 散歩40分、ヨガ20分、スクワット20回×3）",
          });
          return;
        }

        if (incomingText === DIAGNOSIS_RESTART_TEXT) {
          const hadOngoingDiagnosis = diagnosisStepIsOngoing(
            diagnosisState.currentIndex,
          );
          await updateUserRow(lineUserId, {
            diagnosis_step: 0,
            ideal: null,
            temptation: null,
            support_style: null,
            selected_character: null,
            current_weight: null,
            height: null,
            goal_weight: null,
            activity: null,
            deadline: null,
            awaiting_rich_input: null,
          });

          const firstQuestion = await buildDiagnosisQuestionMessage(0);

          if (hadOngoingDiagnosis) {
            await client.replyMessage(event.replyToken, [
              {
                type: "text",
                text: "今のデータは消えちゃうけど、最初からやり直すね！✨",
              },
              firstQuestion,
            ]);
            return;
          }

          await client.replyMessage(event.replyToken, firstQuestion);
          return;
        }

        if (incomingText === DIAGNOSIS_START_TEXT) {
          if (diagnosisStepIsOngoing(diagnosisState.currentIndex)) {
            await client.replyMessage(
              event.replyToken,
              await buildDiagnosisGuardMessage(diagnosisState),
            );
            return;
          }

          // 診断が完了済みの場合は再スタートしない（やり直すにはDIAGNOSIS_RESTART_TEXTが必要）
          if (userRow.deadline !== null) {
            // 通常のAIチャットとして処理するためフォールスルー
          } else {
            await updateUserRow(lineUserId, {
              diagnosis_step: 0,
              ideal: null,
              temptation: null,
              support_style: null,
              current_weight: null,
              height: null,
              goal_weight: null,
              activity: null,
              deadline: null,
              awaiting_rich_input: null,
            });
            await client.replyMessage(
              event.replyToken,
              await buildDiagnosisQuestionMessage(0),
            );
            return;
          }
        }

        // ===== 生理周期登録フロー =====

        const todayStr = new Date().toISOString().split("T")[0];

        // ---- リマインド「生理来たかな？」への返答 ----
        if (
          userRow.pending_period_check &&
          (incomingText === "生理来た！" || incomingText.includes("来た") || incomingText.includes("きた"))
        ) {
          if (supabase) {
            await supabase.from("menstrual_cycles").insert({
              line_user_id: lineUserId,
              start_date: todayStr,
            });
            await updateUserRow(lineUserId, { pending_period_check: null, cycle_reg_step: null });
          }
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "教えてくれてありがとう！📅 今日を生理開始日として記録したよ✨ 終わったら「生理終わった」って教えてね💖",
          });
          return;
        }

        if (
          userRow.pending_period_check &&
          (incomingText === "生理まだかも" || incomingText.includes("まだ") || incomingText.includes("来てない"))
        ) {
          await updateUserRow(lineUserId, { pending_period_check: null });
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "そっか、もうそろそろだね！🌸 体が重かったり違和感あったら教えてね💖 また明日確認するよ！",
          });
          return;
        }

        // ---- 「生理始まった」系 即時登録 ----
        const periodStartKeywords = ["生理始まった", "生理きた", "生理来た", "生理が来た", "生理がきた", "生理スタート"];
        if (periodStartKeywords.some((kw) => incomingText.includes(kw))) {
          if (supabase) {
            await supabase.from("menstrual_cycles").insert({ line_user_id: lineUserId, start_date: todayStr });
            await updateUserRow(lineUserId, { pending_period_check: null, cycle_reg_step: null });
          }
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "生理来たんだね🌸 今日を開始日として記録したよ。ゆっくり休んでね💖 終わったら「生理終わった」って教えてね！",
          });
          return;
        }

        // ---- 「生理終わった」系 → 終了日記録 → 毎月フィードバック開始 ----
        const periodEndKeywords = ["生理終わった", "生理おわった", "生理終わり"];
        if (periodEndKeywords.some((kw) => incomingText.includes(kw))) {
          let openCycleId: number | null = null;
          if (supabase) {
            const { data: openCycle } = await supabase
              .from("menstrual_cycles")
              .select("id")
              .eq("line_user_id", lineUserId)
              .is("end_date", null)
              .order("start_date", { ascending: false })
              .limit(1)
              .single();
            if (openCycle) {
              openCycleId = (openCycle as { id: number }).id;
              await supabase
                .from("menstrual_cycles")
                .update({ end_date: todayStr })
                .eq("id", openCycleId);
            }
          }
          // 毎月フィードバックフロー開始（step 20）
          await updateUserRow(lineUserId, {
            cycle_reg_step: 20,
            pms_symptoms: "[]",
            period_symptoms: "[]",
          });
          await client.replyMessage(
            event.replyToken,
            buildSymptomQuickReply(
              "生理明けたね！✨ お疲れさま💖\n\nせっかくだし今月の生理を振り返っておこ！\nPMSで気になった症状はあった？（複数選べるよ）",
              PMS_SYMPTOMS_LIST,
              [],
              "PMS",
            ),
          );
          return;
        }

        // ---- 「生理登録」コマンド → 初回/過去サイクル登録フロー ----
        if (incomingText === RICH_MENU_PERIOD_REG) {
          await updateUserRow(lineUserId, {
            cycle_reg_step: 0,
            cycle_reg_start_date: null,
            pms_symptoms: "[]",
            period_symptoms: "[]",
            awaiting_rich_input: null,
          });
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "生理の記録をするね📅\n過去3〜6ヶ月分を「開始日〜終了日」の形式で1件ずつ送ってね！\n\n例：\n3/12〜3/18\n2/11〜2/17\n1/14〜1/20\n\n全部送り終わったら「完了」って送ってね！",
          });
          return;
        }

        // ---- 登録フロー中の処理 ----
        if (userRow.cycle_reg_step !== null && userRow.cycle_reg_step >= 0) {
          const step = userRow.cycle_reg_step;

          // ========== Step 0: 開始日〜終了日 を即時INSERT ==========
          if (step === 0) {
            if (incomingText === "完了") {
              // DBから今セッションで登録済みの件数をカウント
              let cycleCount = 0;
              if (supabase) {
                const { count } = await supabase
                  .from("menstrual_cycles")
                  .select("id", { count: "exact", head: true })
                  .eq("line_user_id", lineUserId);
                cycleCount = count ?? 0;
              }
              if (cycleCount === 0) {
                await client.replyMessage(event.replyToken, {
                  type: "text",
                  text: "まだ1件も入力されてないよ！\n「3/12〜3/18」のように「開始日〜終了日」の形式で送ってね📅",
                });
                return;
              }
              await updateUserRow(lineUserId, {
                cycle_reg_step: 2,
                cycle_reg_start_date: null,
                pms_symptoms: "[]",
              });
              await client.replyMessage(
                event.replyToken,
                buildSymptomQuickReply(
                  `${cycleCount}件のサイクルを記録したよ✨\n\nPMSの症状を教えて！（複数選べるよ）`,
                  PMS_SYMPTOMS_LIST,
                  [],
                  "PMS",
                ),
              );
              return;
            }

            // 古いクイックリプライボタンが押された場合のガード
            const isOldButton =
              incomingText.startsWith("PMS") ||
              incomingText.startsWith("生理中") ||
              incomingText === "重さ重い" ||
              incomingText === "重さ普通" ||
              incomingText === "重さ軽め";
            if (isOldButton) {
              await client.replyMessage(event.replyToken, {
                type: "text",
                text: "あれ、古いボタンが残ってたかな😅\n今は生理の日付を入力中だよ！\n\n「3/12〜3/18」のように「開始日〜終了日」の形式で送ってね📅\n最初からやり直す場合は「生理登録」って送ってね！",
              });
              return;
            }

            // 範囲入力をパース（「3/12〜3/18」など）
            const range = parseDateRange(incomingText);
            if (!range) {
              await client.replyMessage(event.replyToken, {
                type: "text",
                text: "うまく読み取れなかったよ😅\n「3/12〜3/18」のように「開始日〜終了日」の形式で送ってね！",
              });
              return;
            }
            const startStr = range.start.toISOString().split("T")[0];
            const endStr = range.end.toISOString().split("T")[0];

            // 重複チェックしてから即時INSERT
            let insertedCount = 0;
            if (supabase) {
              const { data: existing } = await supabase
                .from("menstrual_cycles")
                .select("id")
                .eq("line_user_id", lineUserId)
                .eq("start_date", startStr)
                .limit(1);
              if (!existing || existing.length === 0) {
                await supabase.from("menstrual_cycles").insert({
                  line_user_id: lineUserId,
                  start_date: startStr,
                  end_date: endStr,
                });
              }
              const { count } = await supabase
                .from("menstrual_cycles")
                .select("id", { count: "exact", head: true })
                .eq("line_user_id", lineUserId);
              insertedCount = count ?? 0;
            }
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: `${startStr}〜${endStr} を記録したよ✅（計${insertedCount}件）\n次の周期も送ってね！全部終わったら「完了」って送ってね！`,
            });
            return;
          }

          // ========== Step 2 / 20: PMS症状 蓄積 ==========
          if (step === 2 || step === 20) {
            const isMonthly = step === 20;
            if (incomingText.startsWith("PMS")) {
              const symptom = incomingText.slice(3);
              const currentList: string[] = userRow.pms_symptoms
                ? (JSON.parse(userRow.pms_symptoms) as string[])
                : [];
              if (symptom === "完了" || symptom === "特になし") {
                const nextStep = isMonthly ? 21 : 3;
                await updateUserRow(lineUserId, { cycle_reg_step: nextStep });
                await client.replyMessage(
                  event.replyToken,
                  buildSymptomQuickReply(
                    "ありがとう！💖\n\n生理中の症状は？（複数選べるよ）",
                    PERIOD_SYMPTOMS_LIST,
                    [],
                    "生理中",
                  ),
                );
                return;
              }
              if ((PMS_SYMPTOMS_LIST as readonly string[]).includes(symptom)) {
                if (!currentList.includes(symptom)) currentList.push(symptom);
                await updateUserRow(lineUserId, { pms_symptoms: JSON.stringify(currentList) });
                await client.replyMessage(
                  event.replyToken,
                  buildSymptomQuickReply(
                    `「${symptom}」を追加したよ✅\n他にある？なければ「完了」を押してね！`,
                    PMS_SYMPTOMS_LIST,
                    currentList,
                    "PMS",
                  ),
                );
                return;
              }
            }
            const currentList: string[] = userRow.pms_symptoms
              ? (JSON.parse(userRow.pms_symptoms) as string[])
              : [];
            await client.replyMessage(
              event.replyToken,
              buildSymptomQuickReply("ボタンから選んでね！", PMS_SYMPTOMS_LIST, currentList, "PMS"),
            );
            return;
          }

          // ========== Step 3 / 21: 生理中症状 蓄積 ==========
          if (step === 3 || step === 21) {
            const isMonthly = step === 21;
            if (incomingText.startsWith("生理中")) {
              const symptom = incomingText.slice(3);
              const currentList: string[] = userRow.period_symptoms
                ? (JSON.parse(userRow.period_symptoms) as string[])
                : [];
              if (symptom === "完了" || symptom === "特になし") {
                // 痛みの症状があれば重さを聞く
                const hasPain = currentList.some((s) =>
                  (PAIN_SYMPTOMS as readonly string[]).includes(s),
                );
                if (hasPain) {
                  const nextStep = isMonthly ? 22 : 4;
                  await updateUserRow(lineUserId, { cycle_reg_step: nextStep });
                  await client.replyMessage(event.replyToken as string, {
                    type: "text",
                    text: `腹痛・腰痛・頭痛があったんだね😔\nその痛み、どのくらいだった？`,
                    quickReply: {
                      items: [
                        { type: "action", action: { type: "message", label: "重い😖", text: "重さ重い" } },
                        { type: "action", action: { type: "message", label: "普通", text: "重さ普通" } },
                        { type: "action", action: { type: "message", label: "軽め", text: "重さ軽め" } },
                      ],
                    },
                  } as TextMessage);
                } else {
                  await finalizeCycleSymptoms(lineUserId, null, isMonthly, event.replyToken as string);
                }
                return;
              }
              if ((PERIOD_SYMPTOMS_LIST as readonly string[]).includes(symptom)) {
                if (!currentList.includes(symptom)) currentList.push(symptom);
                await updateUserRow(lineUserId, { period_symptoms: JSON.stringify(currentList) });
                await client.replyMessage(
                  event.replyToken,
                  buildSymptomQuickReply(
                    `「${symptom}」を追加したよ✅\n他にある？なければ「完了」を押してね！`,
                    PERIOD_SYMPTOMS_LIST,
                    currentList,
                    "生理中",
                  ),
                );
                return;
              }
            }
            const currentList: string[] = userRow.period_symptoms
              ? (JSON.parse(userRow.period_symptoms) as string[])
              : [];
            await client.replyMessage(
              event.replyToken,
              buildSymptomQuickReply(
                "ボタンから選んでね！",
                PERIOD_SYMPTOMS_LIST,
                currentList,
                "生理中",
              ),
            );
            return;
          }

          // ========== Step 4 / 22: 痛みの重さ ==========
          if (step === 4 || step === 22) {
            const isMonthly = step === 22;
            const severityMap: Record<string, string> = {
              "重さ重い": "重い",
              "重さ普通": "普通",
              "重さ軽め": "軽め",
            };
            const severity = severityMap[incomingText];
            if (!severity) {
              await client.replyMessage(event.replyToken as string, {
                type: "text",
                text: "ボタンから選んでね！",
                quickReply: {
                  items: [
                    { type: "action", action: { type: "message", label: "重い😖", text: "重さ重い" } },
                    { type: "action", action: { type: "message", label: "普通", text: "重さ普通" } },
                    { type: "action", action: { type: "message", label: "軽め", text: "重さ軽め" } },
                  ],
                },
              } as TextMessage);
              return;
            }
            await finalizeCycleSymptoms(lineUserId, severity, isMonthly, event.replyToken as string);
            return;
          }
        }

        // finalizeCycleSymptoms: 症状をDBに保存して完了メッセージ送信
        async function finalizeCycleSymptoms(
          userId: string,
          severity: string | null,
          isMonthly: boolean,
          replyToken: string,
        ): Promise<void> {
          if (!client) return;
          const latestRow = await fetchOrCreateUserRow(userId);
          const pmsSymptoms = latestRow.pms_symptoms ?? "[]";
          const periodSymptoms = latestRow.period_symptoms ?? "[]";

          if (supabase) {
            // 最新のサイクルレコードに症状を保存
            const { data: latestCycle } = await supabase
              .from("menstrual_cycles")
              .select("id")
              .eq("line_user_id", userId)
              .order("start_date", { ascending: false })
              .limit(1)
              .single();
            if (latestCycle) {
              await supabase
                .from("menstrual_cycles")
                .update({
                  pms_symptoms: pmsSymptoms,
                  period_symptoms: periodSymptoms,
                  symptom_severity: severity,
                })
                .eq("id", (latestCycle as { id: number }).id);
            }
          }
          // users テーブルも最新症状で更新
          await updateUserRow(userId, {
            pms_symptoms: pmsSymptoms,
            period_symptoms: periodSymptoms,
            cycle_reg_step: null,
            cycle_reg_start_date: null,
          });

          // 次回予測テキスト
          let predictionText = "";
          if (supabase) {
            const { data: cycleRows } = await supabase
              .from("menstrual_cycles")
              .select("start_date, end_date")
              .eq("line_user_id", userId)
              .order("start_date", { ascending: false })
              .limit(6);
            if (cycleRows && (cycleRows as unknown[]).length > 0) {
              const cycles: CycleRecord[] = (cycleRows as DbCycleRow[]).map((r) => ({
                startDate: new Date(r.start_date),
                endDate: r.end_date ? new Date(r.end_date) : null,
              }));
              const prediction = predictNextCycle(cycles);
              if (prediction) {
                predictionText =
                  `\n\n📅 次の生理予測: ${formatDateJP(prediction.nextPeriodStart)}ごろ\n` +
                  `🌸 PMS注意日: ${formatDateJP(prediction.pmsStart)}ごろ\n` +
                  `✨ 黄金期: ${formatDateJP(prediction.goldenStart)}〜${formatDateJP(prediction.goldenEnd)}ごろ`;
              }
            }
          }

          const mainText = isMonthly
            ? `今月の記録も完了だよ！ありがとう💖 ウチが毎月チェックしとくね✌️${predictionText}`
            : `登録完了！✨ ウチがちゃんと把握しとくね💖${predictionText}`;

          await client.replyMessage(replyToken, { type: "text", text: mainText });
        }

        // ===== ここまで生理周期登録フロー =====

        if (incomingText === "キャラ変更") {
          await client.replyMessage(
            event.replyToken,
            buildCharacterQuickReplyMessage(),
          );
          return;
        }

        const selectedCharacter = normalizeCharacterInput(incomingText);
        if (selectedCharacter) {
          await updateUserRow(lineUserId, {
            selected_character: selectedCharacter,
          });
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `${CHARACTER_LABELS[selectedCharacter]}に変更したよ！これからこのキャラで返信するね。`,
          });
          return;
        }

        if (diagnosisStepIsOngoing(diagnosisState.currentIndex)) {
          const currentQuestion = DIAGNOSIS_QUESTIONS[diagnosisState.currentIndex];
          const resolvedAnswer = resolveAnswerForQuestion(
            currentQuestion,
            incomingText,
          );
          if (!resolvedAnswer || !isValidAnswer(currentQuestion, resolvedAnswer) && currentQuestion.id !== "ideal" && currentQuestion.id !== "support_style") {
            await client.replyMessage(
              event.replyToken,
              await buildDiagnosisGuardMessage(diagnosisState),
            );
            return;
          }

          diagnosisState.answers[currentQuestion.id] = resolvedAnswer;
          const updatePatch: Partial<DbUserRow> = {};

          if (currentQuestion.id === "ideal") updatePatch.ideal = resolvedAnswer;
          if (currentQuestion.id === "temptation") updatePatch.temptation = resolvedAnswer;
          if (currentQuestion.id === "support_style") {
            diagnosisState.cheerStyle = pickCheerStyle(resolvedAnswer) || "gentle";
            diagnosisState.selectedCharacter = mapStyleToCharacter(
              diagnosisState.cheerStyle,
            );
            updatePatch.support_style = resolvedAnswer;
            updatePatch.selected_character = diagnosisState.selectedCharacter;
          }
          if (currentQuestion.id === "current_weight") {
            updatePatch.current_weight = Number(resolvedAnswer);
          }
          if (currentQuestion.id === "height") {
            updatePatch.height = Number(resolvedAnswer);
          }
          if (currentQuestion.id === "goal_weight") {
            updatePatch.goal_weight = Number(resolvedAnswer);
          }
          if (currentQuestion.id === "activity") updatePatch.activity = resolvedAnswer;
          if (currentQuestion.id === "deadline") updatePatch.deadline = resolvedAnswer;

          const isLastQuestion =
            diagnosisState.currentIndex >= DIAGNOSIS_QUESTIONS.length - 1;
          if (isLastQuestion) {
            updatePatch.diagnosis_step = DIAGNOSIS_QUESTIONS.length;
            await updateUserRow(lineUserId, updatePatch);

            const displayName = await resolveDisplayName(event);
            const roadmap = await generateFinalRoadmap(displayName, diagnosisState);
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: roadmap.slice(0, 4900),
            });
            return;
          }

          const nextIndex = diagnosisState.currentIndex + 1;
          const nextQuestion = DIAGNOSIS_QUESTIONS[nextIndex];
          const baseAizuchi = currentQuestion.aizuchi || "ありがとう！";
          const shouldAdjustTone =
            currentQuestion.id === "current_weight" ||
            currentQuestion.id === "height" ||
            currentQuestion.id === "goal_weight" ||
            currentQuestion.id === "activity";
          const aizuchi = shouldAdjustTone
            ? await styleAdjustText(baseAizuchi, diagnosisState.cheerStyle)
            : baseAizuchi;

          const nextQuestionMessage = await buildDiagnosisQuestionMessage(
            nextIndex,
            diagnosisState.cheerStyle,
          );
          updatePatch.diagnosis_step = nextIndex;
          await updateUserRow(lineUserId, updatePatch);

          if (nextQuestion.choices) {
            await client.replyMessage(event.replyToken, {
              ...nextQuestionMessage,
              text: `${aizuchi}\n\n${nextQuestionMessage.text}`,
            });
            return;
          }

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `${aizuchi}\n\n${nextQuestionMessage.text}`,
          });
          return;
        }

        const activeCharacter = userRow.selected_character || DEFAULT_CHARACTER;
        const lineDisplayName = await resolveDisplayName(event);
        const aiReply = await generateCharacterReply(
          activeCharacter,
          incomingText,
          userRow,
          lineDisplayName,
        );

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: aiReply.slice(0, 4900),
        });
      }),
    );
  } catch (error) {
    console.error("Failed to process LINE webhook:", error);
    return new NextResponse("Failed to process webhook.", { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
