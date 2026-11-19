"use client";

import { useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { examples, maxImportBytes, parseImport, prompts, type Question } from "../lib/imports";
import type { ActiveAttempt, Quiz, Topic } from "../lib/model";

export type Save = <T = unknown>(action: Record<string, unknown>) => Promise<T>;

export function Markdown({ children }: { children: string }) {
  return <div className="markdown"><ReactMarkdown skipHtml disallowedElements={["img"]}>{children}</ReactMarkdown></div>;
}

type Draft = ReturnType<typeof readTopic> | ReturnType<typeof readQuiz>;
function readTopic(raw: string) { return parseImport(raw, "topic"); }
function readQuiz(raw: string) { return parseImport(raw, "quiz"); }

export function ImportForm({ kind, save, topics, close }: { kind: "topic" | "quiz"; save: Save; topics: Topic[]; close: () => void }) {
  const [payload, setPayload] = useState<{ raw: string; data: Draft }>();
  const [topicId, setTopicId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function read(file?: File) {
    setPayload(undefined);
    setMessage("");
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Choose a .json file.");
      if (file.size > maxImportBytes) throw new Error("The file exceeds 512 KiB.");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      setPayload({ raw, data: kind === "topic" ? readTopic(raw) : readQuiz(raw) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read this file.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!payload) return;
    setBusy(true);
    setMessage("");
    try {
      await save({ action: kind === "topic" ? "importTopic" : "importQuiz", raw: payload.raw, topicId });
      close();
    } catch (error) { setMessage(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  }

  return <form className="stack" onSubmit={submit}>
    <label>AI prompt<textarea value={prompts[kind]} rows={5} readOnly /></label>
    <div className="actions">
      <button type="button" className="secondary" onClick={async () => {
        try { await navigator.clipboard.writeText(prompts[kind]); setMessage("Prompt copied."); }
        catch { setMessage("Select and copy the prompt from the text field."); }
      }}>Copy prompt</button>
      <a download={`${kind}-example.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(examples[kind], null, 2))}`}>Download example</a>
    </div>
    {kind === "quiz" && <label>Linked topic<select required value={topicId} onChange={(event) => setTopicId(event.target.value)}>
      <option value="">Select a topic</option>{topics.filter((topic) => !topic.archived).map((topic) => <option value={topic.id} key={topic.id}>{topic.title}</option>)}
    </select></label>}
    <label>JSON file<input type="file" accept=".json,application/json" onChange={(event) => void read(event.target.files?.[0])} /></label>
    {message && <p className={message === "Prompt copied." ? "muted" : "error"} role="status">{message}</p>}
    {payload && <div className="preview stack">
      <h3>Preview · {payload.data.title}</h3>
      {payload.data.type === "topic" ? <>
        <Markdown>{payload.data.content}</Markdown>
        <strong>Recall prompt</strong><p>{payload.data.recallPrompt}</p>
        <strong>Review summary</strong><Markdown>{payload.data.reviewSummary}</Markdown>
      </> : <ol>{payload.data.questions.map((question, index) => <li key={index}>
        <strong>{question.prompt}</strong><ul>{question.options.map((option, optionIndex) => <li key={optionIndex}>{option}{question.correctOptionIndex === optionIndex ? " ✓" : ""}</li>)}</ul>
        <p>{question.explanation}</p>
      </li>)}</ol>}
    </div>}
    <div className="actions"><button disabled={busy || !payload || (kind === "quiz" && !topicId)}>Save import</button></div>
  </form>;
}

export function TopicForm({ topic, save, close }: { topic?: Topic; save: Save; close: () => void }) {
  return <DataForm save={save} close={close} fields={(data) => ({
    action: "topic", id: topic?.id, input: {
      schemaVersion: 1, type: "topic", title: data.get("title"), content: data.get("content"),
      reviewSummary: data.get("summary"), recallPrompt: data.get("prompt"),
    },
  })}>
    <label>Title<input name="title" required maxLength={120} defaultValue={topic?.title} /></label>
    <label>Study material · Markdown<textarea name="content" required rows={8} maxLength={30000} defaultValue={topic?.content} /></label>
    <label>Review summary · Markdown<textarea name="summary" required rows={4} maxLength={2000} defaultValue={topic?.summary} /></label>
    <label>Recall prompt<input name="prompt" required maxLength={300} defaultValue={topic?.prompt} /></label>
  </DataForm>;
}

export function DataForm({ save, close, fields, children, label = "Save", hideSubmit = false }: {
  save: Save; close: () => void; fields: (data: FormData) => Record<string, unknown>; children: React.ReactNode; label?: string; hideSubmit?: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try { await save(fields(new FormData(event.currentTarget))); close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save."); }
    finally { setBusy(false); }
  }
  return <form className="stack" onSubmit={submit}>
    {children}
    {error && <p className="error" role="alert">{error}</p>}
    {!hideSubmit && <div className="actions"><button disabled={busy}>{busy ? "Saving…" : label}</button></div>}
  </form>;
}

const emptyQuestion = (): Question => ({ prompt: "", options: ["", "", "", ""], correctOptionIndex: 0, explanation: "" });

export function QuizForm({ quiz, topics, save, close }: {
  quiz?: Quiz & { questions: Question[] }; topics: Topic[]; save: Save; close: () => void;
}) {
  const [questions, setQuestions] = useState(quiz?.questions ?? [emptyQuestion()]);
  function change(index: number, patch: Partial<Question>) {
    setQuestions((current) => current.map((question, item) => item === index ? { ...question, ...patch } : question));
  }
  return <DataForm save={save} close={close} fields={(data) => ({
    action: "quiz", id: quiz?.id, topicId: quiz?.topic_id ?? data.get("topic"),
    input: { schemaVersion: 1, type: "quiz", title: data.get("title"), questions },
  })}>
    {quiz ? <p>Topic · {topics.find((topic) => topic.id === quiz.topic_id)?.title}</p> : <label>Linked topic<select name="topic" required defaultValue="">
      <option value="">Select a topic</option>{topics.filter((topic) => !topic.archived).map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
    </select></label>}
    <label>Title<input name="title" required maxLength={120} defaultValue={quiz?.title} /></label>
    {questions.map((question, index) => <fieldset className="stack" key={index}>
      <legend>Question {index + 1}</legend>
      <label>Prompt<input value={question.prompt} required maxLength={500} onChange={(event) => change(index, { prompt: event.target.value })} /></label>
      {question.options.map((option, optionIndex) => <label key={optionIndex}>Option {optionIndex + 1}
        <input value={option} required maxLength={250} onChange={(event) => change(index, { options: question.options.map((old, item) => item === optionIndex ? event.target.value : old) })} />
      </label>)}
      <label>Correct option<select value={question.correctOptionIndex} onChange={(event) => change(index, { correctOptionIndex: Number(event.target.value) })}>
        {[0, 1, 2, 3].map((option) => <option key={option} value={option}>Option {option + 1}</option>)}
      </select></label>
      <label>Explanation<textarea value={question.explanation} required maxLength={1000} onChange={(event) => change(index, { explanation: event.target.value })} /></label>
      {questions.length > 1 && <button type="button" className="secondary" onClick={() => setQuestions(questions.filter((_, item) => item !== index))}>Remove question</button>}
    </fieldset>)}
    <div><button type="button" className="secondary" disabled={questions.length >= 30} onClick={() => setQuestions([...questions, emptyQuestion()])}>Add question</button></div>
  </DataForm>;
}

export function QuizAttempt({ attempt, save }: { attempt: ActiveAttempt; save: Save }) {
  const [current, setCurrent] = useState(attempt);
  const [answers, setAnswers] = useState<number[]>(() => attempt.answers ?? attempt.snapshot.map(() => -1));
  return <DataForm save={async <T,>(action: Record<string, unknown>) => {
    const result = await save<ActiveAttempt>(action);
    setCurrent(result);
    return result as T;
  }} close={() => {}} fields={() => ({ action: "submitQuiz", attemptId: current.id, answers })} label="Submit answers" hideSubmit={Boolean(current.submitted_at)}>
    {current.submitted_at && <h3>{current.correct}/{current.total} correct · {Math.round(current.correct! * 100 / current.total)}%</h3>}
    {current.snapshot.map((question, index) => <fieldset key={index}>
      <legend>{index + 1}. {question.prompt}</legend>
      {question.options.map((option, item) => <label className="checkbox" key={item}>
        <input name={`answer-${index}`} type="radio" required checked={answers[index] === item} disabled={Boolean(current.submitted_at)}
          onChange={() => setAnswers((previous) => previous.map((old, position) => position === index ? item : old))} />
        {option}{current.submitted_at && question.correctOptionIndex === item ? " ✓" : ""}
      </label>)}
      {current.submitted_at && <p>{question.explanation}</p>}
    </fieldset>)}
  </DataForm>;
}
