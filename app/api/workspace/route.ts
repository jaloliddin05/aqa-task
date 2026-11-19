import { createClient } from "@supabase/supabase-js";
import { IANAZone } from "luxon";
import { z } from "zod";
import { defaults } from "../../../lib/model";
import { maxImportBytes, parseImport, quizSchema, topicSchema } from "../../../lib/imports";
import { supabaseKey, supabaseUrl } from "../../../lib/env";

const uuid = z.uuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("topic"), id: uuid.optional(), input: topicSchema }),
  z.object({ action: z.literal("importTopic"), raw: z.string() }),
  z.object({ action: z.literal("quiz"), id: uuid.optional(), topicId: uuid, input: quizSchema }),
  z.object({ action: z.literal("importQuiz"), topicId: uuid, raw: z.string() }),
  z.object({ action: z.literal("archive"), id: uuid, archived: z.boolean() }),
  z.object({ action: z.literal("study"), id: uuid }),
  z.object({ action: z.literal("review"), id: uuid, due: z.iso.date(), rating: z.enum(["remembered", "forgot"]) }),
  z.object({ action: z.literal("startQuiz"), id: uuid, attemptId: uuid }),
  z.object({ action: z.literal("submitQuiz"), attemptId: uuid, answers: z.array(z.number().int().min(0).max(3)).min(1).max(30) }),
  z.object({ action: z.literal("settings"), zone: z.string().refine((zone) => IANAZone.isValidZone(zone), "Invalid time zone"), new_limit: z.number().int().min(1).max(30), review_limit: z.number().int().min(1).max(50) }),
  z.object({ action: z.literal("deleteEvent"), id: uuid }),
  z.object({
    action: z.literal("event"), id: uuid.optional(), links: z.array(uuid),
    event: z.strictObject({
      title: z.string().trim().min(1).max(120), notes: z.string().trim().max(3000),
      kind: z.enum(["task", "meeting", "exam", "custom"]), custom_type: z.string().trim().min(1).max(60).nullable(),
      local_date: z.iso.date().nullable(), starts_at: z.iso.datetime({ offset: true }).nullable(),
      ends_at: z.iso.datetime({ offset: true }).nullable(),
      submission: z.enum(["na", "pending", "submitted"]), result: z.enum(["pending", "passed", "not_passed"]),
    }),
  }),
  z.object({ action: z.literal("demo") }),
]);

function fail(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function authenticate(request: Request) {
  if (!supabaseUrl || !supabaseKey) return fail("Set the Supabase environment variables.", 503);
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return fail("Sign in to continue.", 401);
  const authClient = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return fail("Your session expired. Sign in again.", 401);

  const db = createClient(supabaseUrl, supabaseKey, {
    accessToken: async () => token,
  });
  return { db, userId: data.user.id };
}

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const { db, userId } = auth;
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  if (process.env.NODE_ENV === "development") {
    headers.set("X-Workspace-User-Id", userId);
    headers.set("X-Workspace-Supabase-Host", new URL(supabaseUrl!).host);
  }
  try {
    async function readRows(table: string, columns: string, sort = ["id"], submittedOnly = false) {
      const all: unknown[] = [];
      const batchSize = 500;
      for (let offset = 0;; offset += batchSize) {
        let query = db.from(table).select(columns).eq("user_id", userId);
        if (submittedOnly) query = query.not("submitted_at", "is", null);
        for (const column of sort) query = query.order(column);
        const { data, error } = await query.range(offset, offset + batchSize - 1);
        if (error) throw error;
        all.push(...data);
        if (data.length < batchSize) return all;
      }
    }
    const url = new URL(request.url);
    const quizId = url.searchParams.get("quiz");
    if (quizId !== null) {
      if (!uuid.safeParse(quizId).success) return fail("Invalid quiz.", 400);
      const { data, error } = await db.from("quizzes").select("id,topic_id,title,questions")
        .eq("user_id", userId).eq("id", quizId).maybeSingle();
      if (error || !data) return fail("Quiz not found.", 404);
      return Response.json(data, { headers });
    }
    const [topics, reviews, quizzes, attempts, events, links, settings] = await Promise.all([
      readRows("topics", "id,title,content,summary,prompt,created_at,studied_at,due_on,archived"),
      readRows("reviews", "topic_id,rating,completed_at"),
      readRows("quizzes", "id,topic_id,title"),
      readRows("attempts", "id,topic_id,quiz_id,total,correct,submitted_at", ["id"], true),
      readRows("calendar_events", "id,title,notes,kind,custom_type,local_date,starts_at,ends_at,submission,result"),
      readRows("event_topics", "event_id,topic_id", ["event_id", "topic_id"]),
      db.from("settings").select("zone,new_limit,review_limit").eq("user_id", userId).maybeSingle(),
    ]);
    if (settings.error) throw settings.error;
    return Response.json({ topics, reviews, quizzes, attempts, events, links, settings: settings.data ?? defaults },
      { headers });
  } catch (error) {
    console.error("Workspace read failed", error);
    return fail("Could not load your workspace. Check the database setup and try again.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const { db, userId } = auth;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > maxImportBytes * 6 + 1024) return fail("Request is too large.", 413);
    const action = actionSchema.parse(JSON.parse(raw));
    let result;
    switch (action.action) {
      case "topic":
      case "importTopic": {
        const topic = action.action === "topic" ? action.input : parseImport(action.raw, "topic");
        const values = { title: topic.title, content: topic.content, summary: topic.reviewSummary, prompt: topic.recallPrompt };
        result = action.action === "topic" && action.id
          ? await db.from("topics").update(values).eq("id", action.id).select("id").single()
          : await db.from("topics").insert(values).select("id").single();
        break;
      }
      case "quiz":
      case "importQuiz": {
        const quiz = action.action === "quiz" ? action.input : parseImport(action.raw, "quiz");
        const topic = await db.from("topics").select("id").eq("id", action.topicId).eq("archived", false).maybeSingle();
        if (topic.error || !topic.data) return fail("Select an active topic.", 400);
        const values = { title: quiz.title, questions: quiz.questions };
        result = action.action === "quiz" && action.id
          ? await db.from("quizzes").update(values).eq("id", action.id).eq("topic_id", action.topicId).select("id").single()
          : await db.from("quizzes").insert({ ...values, topic_id: action.topicId }).select("id").single();
        break;
      }
      case "archive":
        result = await db.from("topics").update({ archived: action.archived }).eq("id", action.id).select("id").single(); break;
      case "study":
        result = await db.rpc("study_action", { p_topic: action.id }); break;
      case "review":
        result = await db.rpc("study_action", { p_topic: action.id, p_rating: action.rating, p_due: action.due }); break;
      case "startQuiz": {
        const attempt = await db.rpc("quiz_action", { p_attempt: action.attemptId, p_quiz: action.id });
        if (attempt.error) return fail(attempt.error.message, 400);
        const data = Array.isArray(attempt.data) ? attempt.data[0] : attempt.data;
        return Response.json({
          id: data.id, total: data.total, submitted_at: data.submitted_at, answers: data.answers, correct: data.correct,
          snapshot: data.submitted_at ? data.snapshot : data.snapshot.map(({ prompt, options }: { prompt: string; options: string[] }) => ({ prompt, options })),
        });
      }
      case "submitQuiz": {
        const attempt = await db.rpc("quiz_action", { p_attempt: action.attemptId, p_answers: action.answers });
        if (attempt.error) return fail(attempt.error.message, 400);
        const { id, submitted_at, total, correct, answers, snapshot } = Array.isArray(attempt.data) ? attempt.data[0] : attempt.data;
        return Response.json({ id, submitted_at, total, correct, answers, snapshot });
      }
      case "settings": {
        const { zone, new_limit, review_limit } = action;
        result = await db.from("settings").upsert({ user_id: userId, zone, new_limit, review_limit }); break;
      }
      case "event":
        result = await db.rpc("save_event", { p_id: action.id ?? null, p_event: action.event, p_links: [...new Set(action.links)] }); break;
      case "deleteEvent":
        result = await db.from("calendar_events").delete().eq("id", action.id); break;
      case "demo":
        result = await db.rpc("load_demo"); break;
    }
    if (result.error) {
      return fail(result.error.code === "23514" ? "Check the date, end time, and statuses for this event type." : result.error.message, 400);
    }
    return Response.json(result.data);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not save your changes.", 400);
  }
}
