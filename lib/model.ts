import { DateTime } from "luxon";
import type { Question } from "./imports";

export type Topic = { id: string; title: string; content: string; summary: string; prompt: string; created_at: string; studied_at: string | null; due_on: string | null; archived: boolean };
export type Review = { topic_id: string; rating: "remembered" | "forgot"; completed_at: string };
export type Quiz = { id: string; topic_id: string; title: string };
export type Attempt = { id: string; topic_id: string; quiz_id: string; submitted_at: string; total: number; correct: number };
export type ActiveAttempt = { id: string; submitted_at: string | null; total: number; correct: number | null; answers: number[] | null; snapshot: (Pick<Question, "prompt" | "options"> & Partial<Question>)[] };
export type CalendarEvent = {
  id: string; title: string; notes: string; kind: "task" | "meeting" | "exam" | "custom"; custom_type: string | null;
  local_date: string | null; starts_at: string | null; ends_at: string | null;
  submission: "na" | "pending" | "submitted"; result: "pending" | "passed" | "not_passed";
};
export type Settings = { zone: string; new_limit: number; review_limit: number };
export type Workspace = {
  settings: Settings; topics: Topic[]; reviews: Review[]; quizzes: Quiz[]; attempts: Attempt[];
  events: CalendarEvent[]; links: { event_id: string; topic_id: string }[];
};

export const defaults = { zone: "Asia/Tashkent", new_limit: 2, review_limit: 5 };
export const localDay = (stamp: string, zone: string) => DateTime.fromISO(stamp, { zone }).toISODate()!;
export const eventDay = (event: CalendarEvent, zone: string) => event.local_date || localDay(event.starts_at!, zone);
export function overdue(event: CalendarEvent, now: DateTime) {
  return event.kind === "task" && event.submission === "pending" &&
    (event.local_date ? event.local_date < now.toISODate()! : Date.parse(event.starts_at!) < now.toMillis());
}
export function studyQueues(data: Workspace, now: DateTime) {
  const today = now.toISODate()!;
  const dates = new Map(data.events.filter((event) =>
    event.kind === "exam" && Date.parse(event.starts_at!) >= now.toMillis(),
  ).map((event) => [event.id, Date.parse(event.starts_at!)]));
  const priorities = new Map<string, number>();
  for (const link of data.links) {
    const date = dates.get(link.event_id);
    if (date !== undefined) priorities.set(link.topic_id, Math.min(date, priorities.get(link.topic_id) ?? Infinity));
  }
  const compareExam = (a: Topic, b: Topic) =>
    (priorities.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (priorities.get(b.id) ?? Number.MAX_SAFE_INTEGER);
  const active = data.topics.filter((topic) => !topic.archived);
  return {
    fresh: active.filter((topic) => !topic.studied_at)
      .sort((a, b) => compareExam(a, b) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
    due: active.filter((topic) => topic.due_on && topic.due_on <= today)
      .sort((a, b) => a.due_on!.localeCompare(b.due_on!) || compareExam(a, b) || a.id.localeCompare(b.id)),
  };
}

export function learningStreak(data: Workspace, now: DateTime) {
  const stamps = [
    ...data.topics.flatMap((topic) => topic.studied_at ? [topic.studied_at] : []),
    ...data.reviews.map((review) => review.completed_at),
    ...data.attempts.map((attempt) => attempt.submitted_at),
  ];
  const days = new Set(stamps.map((stamp) => localDay(stamp, data.settings.zone)));
  let day = now.startOf("day");
  if (!days.has(day.toISODate()!)) day = day.minus({ days: 1 });
  let count = 0;
  while (days.has(day.toISODate()!)) {
    count++;
    day = day.minus({ days: 1 });
  }
  return count;
}

export function weakReasons(data: Workspace, topicId: string) {
  const reviews = data.reviews.filter((row) => row.topic_id === topicId)
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at)).slice(0, 3);
  const attempts = data.attempts.filter((row) => row.topic_id === topicId)
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at) || b.id.localeCompare(a.id)).slice(0, 2);
  const reasons: string[] = [];
  if (reviews.filter((row) => row.rating === "forgot").length >= 2) reasons.push("Forgot in at least two recent reviews");
  if (attempts.length === 2 && attempts.every((row) => row.correct * 100 < row.total * 70)) {
    reasons.push("Last two quiz attempts below 70%");
  }
  return reasons;
}
