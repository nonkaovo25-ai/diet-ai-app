import { Client } from "@line/bot-sdk";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  predictNextCycle,
  getTodayPhase,
  type CycleRecord,
} from "../../../lib/cycle";
import { nanamiStyleName } from "../../../lib/lineUserDisplayName";

export const runtime = "nodejs";

type DbCycleUser = {
  line_user_id: string;
  pms_symptoms: string | null;
  period_symptoms: string | null;
  pending_period_check: string | null;
};

type DbCycle = {
  line_user_id: string;
  start_date: string;
  end_date: string | null;
};

/** Supabase pg_cron や手動 POST が送るヘッダー用 */
function getRemindSecret(): string {
  return (process.env.REMIND_SECRET ?? "").trim();
}

/** Vercel Cron が送る Authorization: Bearer 用（未設定なら REMIND_SECRET と同じでもよい） */
function getCronSecret(): string {
  return (process.env.CRON_SECRET ?? "").trim();
}

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7).trim();
}

type RemindAuth = "ok" | "missing_secret" | "wrong_secret";

/**
 * 認証の優先順:
 * 1) Authorization: Bearer <CRON_SECRET> … Vercel Cron（GET）
 * 2) x-remind-secret または ?secret= … Supabase / 手動テスト（REMIND_SECRET または CRON_SECRET と一致）
 */
function authorizeRemind(request: Request): RemindAuth {
  const remind = getRemindSecret();
  const cron = getCronSecret();
  if (!remind && !cron) return "missing_secret";

  const bearer = getBearerToken(request);
  if (bearer) {
    if (cron && bearer === cron) return "ok";
    if (remind && bearer === remind) return "ok";
    return "wrong_secret";
  }

  const fromHeader = (request.headers.get("x-remind-secret") ?? "").trim();
  const fromQuery = (
    new URL(request.url).searchParams.get("secret") ?? ""
  ).trim();
  const got = fromHeader || fromQuery;
  if (!got) return "wrong_secret";

  const ok =
    (remind && got === remind) || (cron && got === cron);
  return ok ? "ok" : "wrong_secret";
}

function authFailureResponse(auth: RemindAuth): NextResponse {
  if (auth === "missing_secret") {
    return NextResponse.json(
      {
        error: "REMIND_SECRET も CRON_SECRET もサーバーにありません",
        hint:
          "本番: Vercel の Environment Variables に REMIND_SECRET（必須・Supabase/手動用）と CRON_SECRET（Vercel Cron 用・同じ文字でも可）を設定し、再デプロイしてください。ローカル: .env.local に同様に記載。",
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      error: "Unauthorized",
      hint:
        "次のいずれかが、Vercel に設定した値と完全一致している必要があります: (1) Authorization: Bearer <CRON_SECRET> (2) x-remind-secret または ?secret= <REMIND_SECRET または CRON_SECRET>",
    },
    { status: 401 },
  );
}

async function runRemind(): Promise<NextResponse> {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!channelAccessToken || !supabaseUrl || !supabaseServiceRoleKey) {
    return new NextResponse("Missing environment variables.", { status: 500 });
  }

  const lineClient = new Client({ channelAccessToken });
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("line_user_id, pms_symptoms, period_symptoms, pending_period_check")
    .like("line_user_id", "U%");

  if (usersError || !users) {
    console.error("Failed to fetch users:", usersError);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch users" },
      { status: 500 },
    );
  }

  let sentCount = 0;
  const results: { userId: string; action: string }[] = [];

  for (const user of users as DbCycleUser[]) {
    try {
      const { data: cycleRows } = await supabase
        .from("menstrual_cycles")
        .select("line_user_id, start_date, end_date")
        .eq("line_user_id", user.line_user_id)
        .order("start_date", { ascending: false })
        .limit(6);

      if (!cycleRows || cycleRows.length === 0) continue;

      const cycles: CycleRecord[] = (cycleRows as DbCycle[]).map((r) => ({
        startDate: new Date(r.start_date),
        endDate: r.end_date ? new Date(r.end_date) : null,
      }));

      const prediction = predictNextCycle(cycles);
      if (!prediction) continue;

      const phase = getTodayPhase(today, prediction, cycles);
      if (!phase) continue;

      const pmsSymptoms: string[] = user.pms_symptoms
        ? (JSON.parse(user.pms_symptoms) as string[])
        : [];

      let message: string | null = null;
      let needsQuickReply = false;

      switch (phase.type) {
        case "pms_start":
          // PMS注意期間は複数日だが、リマインドは「入った初日」（dayOfPhase === 1）だけ送る
          if (phase.dayOfPhase !== 1) break;
          message =
            pmsSymptoms.length > 0
              ? `そろそろPMS期間に入りそう💖 ${pmsSymptoms.join("・")}が出やすい時期だから、無理しないでね！🌸`
              : `そろそろPMS期間に入りそう💖 ちょっとしんどくなってきたら無理しないでね！🌸`;
          break;

        case "pms_peak":
          message = `PMS本番近いよ〜！💖 甘いもの食べたくなっても自分を責めないで！今だけだよ✨`;
          break;

        case "period_check":
          if (user.pending_period_check !== todayStr) {
            let callName = "あなた";
            try {
              const prof = await lineClient.getProfile(user.line_user_id);
              callName = nanamiStyleName(prof.displayName || "あなた");
            } catch {
              /* 取得できなければ「あなた」 */
            }
            message = `${callName}、今日生理来たかな？🌸`;
            needsQuickReply = true;
            await supabase
              .from("users")
              .update({ pending_period_check: todayStr })
              .eq("line_user_id", user.line_user_id);
          }
          break;

        case "period_overdue":
          if (
            user.pending_period_check &&
            user.pending_period_check < todayStr
          ) {
            message = `まだ生理来てないかな？🌸 体調どう？無理してないか心配だよ💖`;
            needsQuickReply = true;
            await supabase
              .from("users")
              .update({ pending_period_check: todayStr })
              .eq("line_user_id", user.line_user_id);
          }
          break;

        case "period_end":
          message = `生理明けたね！✨ お疲れさまでした！ここからがダイエット黄金期🔥 一緒に頑張ろ！`;
          break;

        case "golden":
          if (phase.dayOfPhase === 1) {
            message = `今日から黄金期スタート🔥 エストロゲンが上がって脂肪が燃えやすい期間！積極的に動いてこ✌️`;
          }
          break;
      }

      if (!message) continue;

      if (needsQuickReply) {
        await lineClient.pushMessage(user.line_user_id, {
          type: "text",
          text: message,
          quickReply: {
            items: [
              {
                type: "action",
                action: { type: "message", label: "来た！🩸", text: "生理来た！" },
              },
              {
                type: "action",
                action: {
                  type: "message",
                  label: "まだかも…",
                  text: "生理まだかも",
                },
              },
            ],
          },
        });
      } else {
        await lineClient.pushMessage(user.line_user_id, {
          type: "text",
          text: message,
        });
      }

      sentCount++;
      results.push({ userId: user.line_user_id, action: phase.type });

      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`Failed to send reminder to ${user.line_user_id}:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    date: todayStr,
    sentCount,
    results,
  });
}

export async function POST(request: Request) {
  const auth = authorizeRemind(request);
  if (auth !== "ok") return authFailureResponse(auth);
  return runRemind();
}

/** ブラウザから ?secret= でテストしやすいように GET でも同じ処理 */
export async function GET(request: Request) {
  const auth = authorizeRemind(request);
  if (auth !== "ok") return authFailureResponse(auth);
  return runRemind();
}
