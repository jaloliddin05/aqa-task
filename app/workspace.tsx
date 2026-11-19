"use client";

import { createClient, type Session } from "@supabase/supabase-js";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { sections, type Section } from "../lib/sections";
import { DateTime } from "luxon";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { supabaseKey, supabaseUrl } from "../lib/env";
import type { Question } from "../lib/imports";
import {
  eventDay, learningStreak, localDay, overdue, studyQueues, weakReasons,
  type ActiveAttempt, type CalendarEvent, type Quiz, type Topic, type Workspace,
} from "../lib/model";
import { EventBadges, EventEditor } from "./calendar";
import { DataForm, ImportForm, Markdown, QuizAttempt, QuizForm, TopicForm, type Save } from "./content";

const Calendar = dynamic(() => import("./calendar"), { ssr: false, loading: () => <p>Loading calendar…</p> });
type Overlay =
  | { kind: "topicForm"; topic?: Topic }
  | { kind: "import"; type: "quiz" | "topic" }
  | { kind: "topic"; id: string }
  | { kind: "review"; id: string }
  | { kind: "quizForm"; quiz?: Quiz & { questions: Question[] } }
  | { kind: "attempt"; attempt: ActiveAttempt; title: string }
  | { kind: "event"; event?: CalendarEvent; date?: string }
  | { kind: "settings" };

const client = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export default function WorkspaceApp() {
  const [session, setSession] = useState<Session | null>();
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!client) return <main className="landing"><div className="panel stack">
    <h1>QA Study Planner</h1><p>Set the Supabase project URL and publishable key in <code>.env.local</code>, then restart the app.</p>
  </div></main>;
  if (session === undefined) return <main className="landing"><p>Loading…</p></main>;
  return session ? <SignedIn key={session.user.id} email={session.user.email ?? ""} /> : <Authentication />;
}

function Authentication() {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const fields = new FormData(event.currentTarget);
    const email = z.email().safeParse(String(fields.get("email")).trim());
    if (!email.success) { setMessage("Enter a valid email address."); return; }
    const password = String(fields.get("password"));
    setBusy(true);
    try {
      const response = register
        ? await client!.auth.signUp({ email: email.data, password })
        : await client!.auth.signInWithPassword({ email: email.data, password });
      if (response.error) setMessage(response.error.message);
      else if (!response.data.session) setMessage("The account has no active session. Check that Confirm email is disabled in Supabase.");
    } catch {
      setMessage("Could not reach Supabase. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return <main className="landing">
    <section className="auth-intro">
      <span className="brand-mark">QA</span>
      <h1>QA Study Planner</h1>
      <p>Plan your exams, study your QA topics, and review them on a schedule.</p>
    </section>
    <form className="panel stack auth-card" onSubmit={submit}>
      <h2>{register ? "Create an account" : "Log in"}</h2>
      <label>Email<input name="email" type="email" required autoComplete="email" /></label>
      <label>Password<input name="password" type="password" required minLength={register ? 8 : undefined} autoComplete={register ? "new-password" : "current-password"} /></label>
      {message && <p className="error" role="alert">{message}</p>}
      <button disabled={busy}>{busy ? "Please wait…" : register ? "Register" : "Log in"}</button>
      <button type="button" className="text-button" onClick={() => { setRegister(!register); setMessage(""); }}>
        {register ? "Already have an account? Log in" : "Create an account"}
      </button>
    </form>
  </main>;
}

async function request<T>(action?: Record<string, unknown>, query = ""): Promise<T> {
  const response = await client!.auth.getSession();
  if (!response.data.session) throw new Error("Sign in to continue.");
  const result = await fetch(`/api/workspace${query}`, {
    method: action ? "POST" : "GET",
    cache: "no-store",
    headers: { Authorization: `Bearer ${response.data.session.access_token}`, ...(action ? { "Content-Type": "application/json" } : {}) },
    body: action ? JSON.stringify(action) : undefined,
  });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error ?? "Request failed.");
  return data as T;
}

function SignedIn({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const section = sections.find(({ slug }) => pathname === `/${slug}`)?.title ?? "Today";
  const [data, setData] = useState<Workspace>();
  const [dialog, setDialog] = useState<{ section: Section; overlay: Overlay }>();
  const overlay = dialog?.section === section ? dialog.overlay : undefined;
  const setOverlay = (value: Overlay) => setDialog({ section, overlay: value });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const loadVersion = useRef(0);
  const close = () => setDialog(undefined);

  useEffect(() => {
    setMessage("");
    setDialog((current) => current?.section === section ? current : undefined);
  }, [section]);

  const reload = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const fresh = await request<Workspace>();
      if (version === loadVersion.current) { setData(fresh); setError(""); }
    } catch (cause) {
      if (version === loadVersion.current) setError(cause instanceof Error ? cause.message : "Could not load workspace.");
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    function refresh() { setClock(Date.now()); void reload(); }
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [reload]);

  const save: Save = async <T,>(action: Record<string, unknown>) => {
    const result = await request<T>(action);
    if (action.action !== "startQuiz") await reload();
    return result;
  };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); }
    finally { setBusy(false); }
  }

  const now = data ? DateTime.fromMillis(clock, { zone: data.settings.zone }) : null;
  const today = now?.toISODate();
  const shownTopic = overlay && (overlay.kind === "topic" || overlay.kind === "review")
    ? data?.topics.find((topic) => topic.id === overlay.id) : undefined;
  const openEvent = (event?: CalendarEvent, date?: string) => setOverlay({ kind: "event", event, date });

  function startQuiz(quiz: Quiz) {
    const attemptId = crypto.randomUUID();
    void run(async () => {
      const attempt = await save<ActiveAttempt>({ action: "startQuiz", id: quiz.id, attemptId });
      setOverlay({ kind: "attempt", attempt, title: quiz.title });
    });
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">QA</span><strong>Study Planner</strong></div>
      <nav aria-label="Workspace">
        {sections.map(({ slug, title, icon }) => <Link key={slug} href={`/${slug}`} className={section === title ? "selected" : ""} aria-current={section === title ? "page" : undefined}>
          <span aria-hidden="true">{icon}</span>{title}
        </Link>)}
      </nav>
      <div className="sidebar-bottom">
        <span title={email}>{email}</span>
        <button className="secondary" disabled={!data} onClick={() => setOverlay({ kind: "settings" })}>Settings</button>
        <button className="secondary" disabled={busy} onClick={() => void run(async () => {
          const result = await client!.auth.signOut();
          if (result.error) throw result.error;
        })}>Log out</button>
      </div>
    </aside>
    <main className="main">
      <header className="section-head page-head">
        <div>{now && <p className="eyebrow">{now.toFormat("cccc, d LLLL")}</p>}<h1>{section}</h1></div>
        {data && <button className="secondary" disabled={busy} onClick={() => void run(async () => {
          await save({ action: "demo" });
          setMessage("Demo data loaded.");
        })}>Load demo data</button>}
      </header>
      {error && <p className="error notice" role="alert">{error} <button className="text-button" onClick={() => void reload()}>Refresh</button></p>}
      {message && <p className="notice" role="status">{message}</p>}
      {!data && !error && <p>Loading your workspace…</p>}
      {data && now && <>
        {section === "Today" && <Today data={data} now={now} open={setOverlay} openEvent={(event) => {
          setDialog({ section: "Calendar", overlay: { kind: "event", event } });
          router.push("/calendar");
        }} />}
        {section === "Calendar" && <Calendar data={data} now={now} open={openEvent} initialDate={overlay?.kind === "event" && overlay.event ? eventDay(overlay.event, data.settings.zone) : undefined} />}
        {section === "Topics" && <div className="stack">
          <div className="actions"><button onClick={() => setOverlay({ kind: "topicForm" })}>Add topic</button><button className="secondary" onClick={() => setOverlay({ kind: "import", type: "topic" })}>Import topic</button></div>
          {!data.topics.length && <Empty>Add a topic or import study material to get started.</Empty>}
          <div className="cards">
            {[...data.topics].sort((a, b) => Number(a.archived) - Number(b.archived) || b.created_at.localeCompare(a.created_at)).map((topic) =>
              <TopicCard key={topic.id} topic={topic} open={() => setOverlay({ kind: "topic", id: topic.id })} />)}
          </div>
        </div>}
        {section === "Tests" && <div className="stack">
          <div className="actions"><button disabled={!data.topics.some((topic) => !topic.archived)} onClick={() => setOverlay({ kind: "quizForm" })}>Add quiz</button>
            <button className="secondary" disabled={!data.topics.some((topic) => !topic.archived)} onClick={() => setOverlay({ kind: "import", type: "quiz" })}>Import quiz</button></div>
          {!data.quizzes.length && <Empty>Add an active topic, then create or import a quiz for it.</Empty>}
          <div className="cards">{data.quizzes.map((quiz) => {
            const topic = data.topics.find((item) => item.id === quiz.topic_id);
            const count = data.attempts.filter((item) => item.quiz_id === quiz.id).length;
            return <article className="panel stack" key={quiz.id}>
              <p className="eyebrow">{topic?.title}{topic?.archived ? " · Archived" : ""}</p><h3>{quiz.title}</h3>
              <p className="muted">{count} submitted {count === 1 ? "attempt" : "attempts"}</p>
              <div className="actions"><button disabled={busy || topic?.archived} onClick={() => startQuiz(quiz)}>Start quiz</button>
                <button className="secondary" disabled={busy || topic?.archived} onClick={() => void run(async () => {
                  const fullQuiz = await request<Quiz & { questions: Question[] }>(undefined, `?quiz=${quiz.id}`);
                  setOverlay({ kind: "quizForm", quiz: fullQuiz });
                })}>Edit</button></div>
            </article>;
          })}</div>
        </div>}
        {section === "Review" && <div className="study-grid">
          <Queue title="Due and overdue" topics={studyQueues(data, now).due} empty="You're caught up." open={(topic) => setOverlay({ kind: "review", id: topic.id })} />
          <Queue title="Scheduled" topics={data.topics.filter((topic) => !topic.archived && topic.due_on && topic.due_on > today!).sort((a, b) => a.due_on!.localeCompare(b.due_on!))}
            empty="Studied topics appear here before their next review." open={(topic) => setOverlay({ kind: "review", id: topic.id })} />
        </div>}
        {section === "Dashboard" && <Dashboard data={data} now={now} open={(topic) => setOverlay({ kind: "topic", id: topic.id })} />}
      </>}
      {data && now && overlay && <Dialog key={`${overlay.kind}-${shownTopic?.id ?? ""}`} title={overlayTitle(overlay, shownTopic)} close={close}>
        {overlay.kind === "topicForm" && <TopicForm topic={overlay.topic} save={save} close={close} />}
        {overlay.kind === "import" && <ImportForm kind={overlay.type} topics={data.topics} save={save} close={close} />}
        {overlay.kind === "quizForm" && <QuizForm quiz={overlay.quiz} topics={data.topics} save={save} close={close} />}
        {overlay.kind === "attempt" && <QuizAttempt attempt={overlay.attempt} save={save} />}
        {overlay.kind === "topic" && shownTopic && <TopicDetail topic={shownTopic} save={save} edit={() => setOverlay({ kind: "topicForm", topic: shownTopic })} />}
        {overlay.kind === "review" && shownTopic && <Recall topic={shownTopic} today={today!} save={save} close={close} />}
        {overlay.kind === "event" && <>
          <EventEditor event={overlay.event} date={overlay.date ?? today!} data={data} save={save} close={close} />
          {overlay.event?.kind === "exam" && Date.parse(overlay.event.starts_at!) >= now.toMillis() && (() => {
            const linked = new Set(data.links.filter((link) => link.event_id === overlay.event?.id).map((link) => link.topic_id));
            const eligible = data.topics.filter((topic) => linked.has(topic.id) && !topic.archived && topic.due_on && topic.due_on > today!);
            return eligible.length > 0 && <section className="stack"><h3>Extra exam practice</h3>
              {eligible.map((topic) => <button key={topic.id} className="secondary" onClick={() => setOverlay({ kind: "review", id: topic.id })}>{topic.title}</button>)}
            </section>;
          })()}
        </>}
        {overlay.kind === "settings" && <DataForm save={save} close={close} fields={(fields) => ({
          action: "settings", zone: String(fields.get("zone")).trim(),
          new_limit: Number(fields.get("new_limit")), review_limit: Number(fields.get("review_limit")),
        })}>
          <label>Time zone<input name="zone" required defaultValue={data.settings.zone} placeholder="Asia/Tashkent" /></label>
          <label>New topics per day<input name="new_limit" type="number" min={1} max={30} required defaultValue={data.settings.new_limit} /></label>
          <label>Reviews per day<input name="review_limit" type="number" min={1} max={50} required defaultValue={data.settings.review_limit} /></label>
        </DataForm>}
      </Dialog>}
    </main>
  </div>;
}

function overlayTitle(overlay: Overlay, topic?: Topic) {
  switch (overlay.kind) {
    case "topicForm": return overlay.topic ? "Edit topic" : "Add topic";
    case "import": return overlay.type === "topic" ? "Import topic" : "Import quiz";
    case "topic": case "review": return topic?.title ?? "Topic";
    case "quizForm": return overlay.quiz ? "Edit quiz" : "Add quiz";
    case "attempt": return overlay.title;
    case "event": return overlay.event?.title ?? "Add event";
    case "settings": return "Study settings";
  }
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className="section-head"><h2 id="dialog-title">{title}</h2><button className="secondary" onClick={close}>Close</button></header>
    <div className="dialog-body stack">{children}</div>
  </dialog>;
}

function TopicDetail({ topic, save, edit }: { topic: Topic; save: Save; edit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(action: Record<string, unknown>) {
    setBusy(true); setError("");
    try { await save(action); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save."); }
    finally { setBusy(false); }
  }
  return <>
    <Markdown>{topic.content}</Markdown>
    {topic.due_on && <p className="muted">Next scheduled review · {topic.due_on}</p>}
    <div className="actions">
      {!topic.studied_at && !topic.archived && <button disabled={busy} onClick={() => void submit({ action: "study", id: topic.id })}>Mark as studied</button>}
      <button className="secondary" onClick={edit}>Edit</button>
      <button className="secondary" disabled={busy} onClick={() => void submit({ action: "archive", id: topic.id, archived: !topic.archived })}>{topic.archived ? "Restore topic" : "Archive topic"}</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}

function Recall({ topic, today, save, close }: { topic: Topic; today: string; save: Save; close: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const due = Boolean(topic.due_on && topic.due_on <= today && !topic.archived);
  async function rate(rating: "forgot" | "remembered") {
    setBusy(true); setError("");
    try {
      const next = await save<string>({ action: "review", id: topic.id, due: topic.due_on, rating });
      setMessage(`Review recorded. Next review: ${next}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record review."); }
    finally { setBusy(false); }
  }
  return <>
    <p className="eyebrow">{message ? "Review complete" : due ? "Scheduled review" : "Extra practice"}</p>
    <h3>{topic.prompt}</h3>
    {!revealed && <div><button onClick={() => setRevealed(true)}>Reveal summary</button></div>}
    {revealed && <Markdown>{topic.summary}</Markdown>}
    {revealed && !message && due && <div className="actions">
      <button className="secondary" disabled={busy} onClick={() => void rate("forgot")}>Forgot</button>
      <button disabled={busy} onClick={() => void rate("remembered")}>Remembered</button>
    </div>}
    {revealed && !message && !due && <p className="muted">Next scheduled review · {topic.due_on}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <><p role="status">{message}</p><div><button onClick={close}>Done</button></div></>}
  </>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

function TopicCard({ topic, open }: { topic: Topic; open: () => void }) {
  return <button className="panel topic-card" onClick={open}>
    <span className={`badge ${topic.studied_at ? "kind-meeting" : "kind-task"}`}>{topic.archived ? "Archived" : topic.studied_at ? "Studied" : "New"}</span>
    <strong>{topic.title}</strong>
    {topic.due_on && <span className="muted">Review · {topic.due_on}</span>}
  </button>;
}

function Queue({ title, topics, empty, open, count }: { title: string; topics: Topic[]; empty: string; open: (topic: Topic) => void; count?: number }) {
  return <section className="stack">
    <div className="section-head"><h2>{title}</h2><span className="muted">{count !== undefined && count > topics.length ? `${topics.length} of ${count}` : topics.length}</span></div>
    {!topics.length && <Empty>{empty}</Empty>}
    {topics.map((topic) => <TopicCard key={topic.id} topic={topic} open={() => open(topic)} />)}
  </section>;
}

function Today({ data, now, open, openEvent }: { data: Workspace; now: DateTime; open: (overlay: Overlay) => void; openEvent: (event: CalendarEvent) => void }) {
  const { fresh, due } = studyQueues(data, now);
  const today = now.toISODate()!;
  const firstOfDay = now.startOf("day").toMillis();
  const todayEvents = data.events.filter((event) =>
    overdue(event, now) || eventDay(event, data.settings.zone) === today ||
    (event.ends_at !== null && Date.parse(event.starts_at!) < firstOfDay && Date.parse(event.ends_at) > firstOfDay),
  ).sort((a, b) => Number(overdue(b, now)) - Number(overdue(a, now)) ||
    DateTime.fromISO(a.starts_at ?? a.local_date!, { zone: data.settings.zone }).toMillis() -
    DateTime.fromISO(b.starts_at ?? b.local_date!, { zone: data.settings.zone }).toMillis());
  const studiedToday = data.topics.filter((topic) => topic.studied_at && localDay(topic.studied_at, data.settings.zone) === today).length;
  const reviewedToday = data.reviews.filter((review) => localDay(review.completed_at, data.settings.zone) === today).length;
  const newSlots = Math.max(0, data.settings.new_limit - studiedToday);
  const reviewSlots = Math.max(0, data.settings.review_limit - reviewedToday);
  return <div className="stack roomy">
    <section className="panel overview section-head">
      <div><h2>Your study plan</h2><p>{studiedToday} studied · {reviewedToday} reviewed today</p></div>
      <div className="streak"><strong>{learningStreak(data, now)}</strong><span>day streak</span></div>
    </section>
    <div className="study-grid">
      <Queue title="New material" topics={fresh.slice(0, newSlots)} count={fresh.length} empty={fresh.length ? "You reached today's new topic limit." : "No new topics queued."} open={(topic) => open({ kind: "topic", id: topic.id })} />
      <Queue title="Due reviews" topics={due.slice(0, reviewSlots)} count={due.length} empty={due.length ? "You reached today's review limit. Remaining items are in Review." : "No reviews due."} open={(topic) => open({ kind: "review", id: topic.id })} />
    </div>
    <section className="stack">
      <h2>Upcoming and due</h2>
      {!todayEvents.length && <Empty>No events scheduled today or overdue.</Empty>}
      {todayEvents.map((event) => <button className="panel event-row" key={event.id} onClick={() => openEvent(event)}>
        <span><strong>{event.title}</strong><span className="muted">{event.local_date ?? DateTime.fromISO(event.starts_at!, { zone: data.settings.zone }).toFormat("d LLL · HH:mm")}</span></span>
        <EventBadges event={event} now={now} />
      </button>)}
    </section>
  </div>;
}

function Dashboard({ data, now, open }: { data: Workspace; now: DateTime; open: (topic: Topic) => void }) {
  const [period, setPeriod] = useState("30");
  const today = now.toISODate()!;
  const start = period === "all" ? null : now.minus({ days: Number(period) - 1 }).toISODate();
  const inRange = (stamp: string) => {
    const date = localDay(stamp, data.settings.zone);
    return date <= today && (!start || date >= start);
  };
  const reviews = data.reviews.filter((row) => inRange(row.completed_at));
  const due = studyQueues(data, now).due;
  const attempts = data.attempts.filter((row) => inRange(row.submitted_at));
  const scores = new Map<string, { correct: number; total: number; count: number }>();
  for (const attempt of attempts) {
    const score = scores.get(attempt.topic_id) ?? { correct: 0, total: 0, count: 0 };
    score.correct += attempt.correct; score.total += attempt.total; score.count++;
    scores.set(attempt.topic_id, score);
  }
  const weak = data.topics.filter((topic) => !topic.archived)
    .map((topic) => ({ topic, reasons: weakReasons(data, topic.id) })).filter((item) => item.reasons.length);
  const metrics = [
    ["Topics added", data.topics.filter((topic) => inRange(topic.created_at)).length],
    ["First studied", data.topics.filter((topic) => topic.studied_at && inRange(topic.studied_at)).length],
    ["Topics reviewed", new Set(reviews.map((row) => row.topic_id)).size],
    ["Review sessions", reviews.length],
    ["Due today", due.filter((topic) => topic.due_on === today).length],
    ["Overdue reviews", due.filter((topic) => topic.due_on! < today).length],
    ["Day streak", learningStreak(data, now)],
  ] as const;
  return <div className="stack roomy">
    <div className="actions"><label className="inline">Activity range<select value={period} onChange={(event) => setPeriod(event.target.value)}>
      <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option>
    </select></label></div>
    <div className="metrics">{metrics.map(([label, value]) => <div key={label} className="panel metric"><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="study-grid">
      <section className="panel stack"><h2>Weak topics</h2>
        {!weak.length && <p className="muted">No topics currently meet the weak-topic criteria.</p>}
        {weak.map(({ topic, reasons }) => <div key={topic.id} className="table-row"><button className="text-button" onClick={() => open(topic)}>{topic.title}</button><span>{reasons.join(" · ")}</span></div>)}
      </section>
      <section className="panel stack"><h2>Quiz accuracy</h2>
        {!data.topics.length && <p className="muted">No topics yet.</p>}
        {data.topics.map((topic) => {
          const score = scores.get(topic.id);
          return <div key={topic.id} className="table-row"><span>{topic.title}</span><strong>{score ? `${Math.round(score.correct * 100 / score.total)}% · ${score.count} ${score.count === 1 ? "attempt" : "attempts"}` : "No attempts"}</strong></div>;
        })}
      </section>
    </div>
  </div>;
}
