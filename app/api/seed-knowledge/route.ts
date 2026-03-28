import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ALL_KNOWLEDGE_CHUNKS } from "../../../knowledge";

export const runtime = "nodejs";

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const seedSecret = process.env.SEED_SECRET?.trim();

async function embedText(text: string): Promise<number[] | null> {
  if (!openAIApiKey) return null;
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
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error: ${response.status} ${err}`);
  }
  const data = (await response.json()) as {
    data?: Array<{ embedding: number[] }>;
  };
  return data.data?.[0]?.embedding ?? null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");

  if (!seedSecret || secret !== seedSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!openAIApiKey || !supabaseUrl || !supabaseServiceRoleKey) {
    return new NextResponse("Missing environment variables.", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const results: { source: string; status: string }[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (const chunk of ALL_KNOWLEDGE_CHUNKS) {
    try {
      const embedding = await embedText(chunk.content);
      if (!embedding) {
        results.push({ source: chunk.source, status: "error: no embedding" });
        errorCount++;
        continue;
      }

      const { error } = await supabase.from("knowledge_chunks").insert({
        source: chunk.source,
        content: chunk.content,
        embedding,
      });

      if (error) {
        results.push({ source: chunk.source, status: `error: ${error.message}` });
        errorCount++;
      } else {
        results.push({ source: chunk.source, status: "ok" });
        successCount++;
      }

      // APIレート制限を避けるため少し待機
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ source: chunk.source, status: `error: ${message}` });
      errorCount++;
    }
  }

  return NextResponse.json({
    message: `シーディング完了: 成功 ${successCount}件、失敗 ${errorCount}件`,
    total: ALL_KNOWLEDGE_CHUNKS.length,
    successCount,
    errorCount,
    results,
  });
}
