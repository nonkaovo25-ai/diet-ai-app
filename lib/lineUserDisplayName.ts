/**
 * LINE プロフィールの displayName から、キャラクター別の呼び方を組み立てる。
 */

/** ななみ用: 「みかん」→「みかんちゃん」、すでに「◯◯ちゃん」ならそのまま */
export function nanamiStyleName(displayName: string): string {
  const raw = displayName.trim() || "あなた";
  if (raw === "あなた") return "あなた";
  if (raw.endsWith("ちゃん")) return raw;
  const without = raw.replace(/(ちゃん|くん|さん)$/u, "").trim() || raw;
  return `${without}ちゃん`;
}

/** ひまり・凛用: 自然なさん付け */
export function politeCallName(displayName: string): string {
  const raw = displayName.trim() || "あなた";
  if (raw === "あなた") return "あなた";
  if (raw.endsWith("さん") || raw.endsWith("ちゃん")) return raw;
  return `${raw}さん`;
}

/** AI システムプロンプト用: 必ず実名で呼ばせる一文 */
export function buildDisplayNameInstruction(
  character: "ひまり" | "凛" | "ななみ",
  displayName: string,
): string {
  const safe = displayName.trim() || "あなた";
  const nm = nanamiStyleName(safe);
  const pl = politeCallName(safe);
  if (character === "ななみ") {
    return (
      `\n\n# ユーザー呼び方（必須）\n` +
      `- LINEの表示名は「${safe}」\n` +
      `- 二人称は必ず「${nm}」を使う（「〇〇ちゃん」などのプレースホルダは禁止）\n`
    );
  }
  return (
    `\n\n# ユーザー呼び方（必須）\n` +
    `- LINEの表示名は「${safe}」\n` +
    `- 会話では「${pl}」のように、この名前で自然に呼びかける\n`
  );
}
