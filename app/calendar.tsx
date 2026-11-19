"use client";

import { useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGrid from "@fullcalendar/daygrid";
import timeGrid from "@fullcalendar/timegrid";
import list from "@fullcalendar/list";
import interaction from "@fullcalendar/interaction";
import luxon from "@fullcalendar/luxon3";
import { DateTime } from "luxon";
import { overdue, type CalendarEvent, type Workspace } from "../lib/model";
import { DataForm, type Save } from "./content";

const kinds = ["task", "meeting", "exam", "custom"] as const;
const submissionLabels = { na: "Not applicable", pending: "Not submitted", submitted: "Submitted" };
const resultLabels = { pending: "Result pending", passed: "Passed", not_passed: "Not passed" };
const kindLabels = { task: "Task", meeting: "Meeting", exam: "Exam", custom: "Custom" };

export function EventBadges({ event, now }: { event: CalendarEvent; now: DateTime }) {
  return <span className="badges">
    <span className={`badge kind-${event.kind}`}>{event.custom_type ?? kindLabels[event.kind]}</span>
    {event.submission !== "na" && <span className={`badge submission-${event.submission}`}>{event.submission === "submitted" ? "✓ " : "○ "}{submissionLabels[event.submission]}</span>}
    {event.kind === "exam" && <span className={`badge result-${event.result}`}>{resultLabels[event.result]}</span>}
    {overdue(event, now) && <span className="badge late">Overdue</span>}
  </span>;
}

export default function Calendar({ data, now, open, initialDate }: {
  initialDate?: string; data: Workspace; now: DateTime; open: (event?: CalendarEvent, date?: string) => void;
}) {
  const [types, setTypes] = useState<string[]>([]);
  const [submissions, setSubmissions] = useState<string[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [late, setLate] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>();
  const events = data.events.filter((event) => (!types.length || types.includes(event.kind)) &&
    (!submissions.length || submissions.includes(event.submission)) &&
    (!results.length || (event.kind === "exam" && results.includes(event.result))) &&
    (!late || overdue(event, now)));
  const initialView = typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches ? "listWeek" : "dayGridMonth";

  function filter<T extends string>(label: string, choices: Record<T, string>, selected: string[], change: (items: string[]) => void) {
    return <details className="filter"><summary>{label}{selected.length ? ` (${selected.length})` : ""}</summary>
      {(Object.entries(choices) as [T, string][]).map(([key, title]) => <label key={key} className="checkbox">
        <input type="checkbox" checked={selected.includes(key)} onChange={() => change(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key])} />{title}
      </label>)}
    </details>;
  }

  return <div className="stack">
    <div className="actions">
      <button onClick={() => open(undefined, selectedDay)}>Add event</button>
      {filter("Event type", kindLabels, types, setTypes)}
      {filter("Submission", submissionLabels, submissions, setSubmissions)}
      {filter("Exam result", resultLabels, results, setResults)}
      <label className="checkbox"><input type="checkbox" checked={late} onChange={(event) => setLate(event.target.checked)} />Overdue only</label>
    </div>
    <div className="panel calendar-panel">
      <FullCalendar plugins={[dayGrid, timeGrid, list, interaction, luxon]} timeZone={data.settings.zone}
        initialView={initialView} initialDate={initialDate} height="auto" nowIndicator dayMaxEvents={3}
        headerToolbar={{ start: "prev,next today", center: "title", end: "dayGridMonth,timeGridWeek,listWeek" }}
        buttonText={{ today: "Today", month: "Month", week: "Week", list: "Agenda" }}
        events={events.map((event) => ({
          id: event.id, title: event.title, start: event.local_date ?? event.starts_at!,
          end: event.ends_at ?? undefined, allDay: Boolean(event.local_date), extendedProps: { item: event },
        }))}
        eventClick={(info) => open(info.event.extendedProps.item as CalendarEvent)}
        dateClick={(info) => setSelectedDay(info.dateStr.slice(0, 10))}
        eventContent={(info) => <div className="calendar-event">
          <strong>{info.timeText ? `${info.timeText} · ` : ""}{info.event.title}</strong>
          <EventBadges event={info.event.extendedProps.item as CalendarEvent} now={now} />
        </div>}
      />
    </div>
    {selectedDay && <section className="panel stack">
      <div className="section-head"><h3>{selectedDay}</h3><button onClick={() => open(undefined, selectedDay)}>Add event for this day</button></div>
      {events.filter((event) => {
        if (event.local_date) return event.local_date === selectedDay;
        const start = DateTime.fromISO(event.starts_at!, { zone: data.settings.zone });
        const end = event.ends_at ? DateTime.fromISO(event.ends_at, { zone: data.settings.zone }).minus({ milliseconds: 1 }) : start;
        return start.toISODate()! <= selectedDay && end.toISODate()! >= selectedDay;
      }).map((event) => <div key={event.id} className="actions"><button className="text-button" onClick={() => open(event)}>{event.title}</button><EventBadges event={event} now={now} /></div>)}
    </section>}
  </div>;
}

export function EventEditor({ event, date, data, save, close }: {
  event?: CalendarEvent; date: string; data: Workspace; save: Save; close: () => void;
}) {
  const [kind, setKind] = useState<CalendarEvent["kind"]>(event?.kind ?? "task");
  const [dateOnly, setDateOnly] = useState(event ? Boolean(event.local_date) : true);
  const [submission, setSubmission] = useState<CalendarEvent["submission"]>(event?.submission ?? "pending");
  const [result, setResult] = useState<CalendarEvent["result"]>(event?.result ?? "pending");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const withTime = kind === "exam" || kind === "meeting" || !dateOnly;
  const zone = data.settings.zone;
  const linked = new Set(data.links.filter((link) => link.event_id === event?.id).map((link) => link.topic_id));
  function convert(value: FormDataEntryValue | null) {
    if (!value) return null;
    const raw = String(value);
    const parsed = DateTime.fromISO(raw, { zone });
    if (!parsed.isValid || parsed.toFormat("yyyy-MM-dd'T'HH:mm") !== raw) throw new Error("Choose a valid local date and time.");
    return parsed.toUTC().toISO();
  }
  return <DataForm save={save} close={close} fields={(fields) => {
    const starts = withTime ? convert(fields.get("start")) : null;
    const ends = withTime && kind !== "task" ? convert(fields.get("end")) : null;
    if (ends && starts && ends <= starts) throw new Error("The end time must be later than the start.");
    return { action: "event", id: event?.id, links: kind === "exam" ? fields.getAll("topics") : [], event: {
      title: fields.get("title"), kind, custom_type: kind === "custom" ? fields.get("custom") : null, notes: fields.get("notes"),
      local_date: withTime ? null : fields.get("date"), starts_at: starts, ends_at: ends,
      submission: kind === "task" || kind === "custom" ? submission : "na", result: kind === "exam" ? result : "pending",
    } };
  }}>
    <label>Title<input defaultValue={event?.title} required name="title" maxLength={120} /></label>
    <label>Event type<select value={kind} onChange={(change) => {
      const next = change.target.value as CalendarEvent["kind"];
      setKind(next);
      setSubmission(next === "task" ? "pending" : "na");
      setResult("pending");
    }}>{kinds.map((item) => <option key={item} value={item}>{kindLabels[item]}</option>)}</select></label>
    {kind === "custom" && <label>Custom type<input name="custom" maxLength={60} required defaultValue={event?.custom_type ?? ""} /></label>}
    {(kind === "task" || kind === "custom") && <label className="checkbox"><input type="checkbox" checked={dateOnly} onChange={(change) => setDateOnly(change.target.checked)} />Date only</label>}
    {withTime ? <div className="form-grid">
      <label>{kind === "task" ? "Deadline" : "Starts"}<input type="datetime-local" name="start" required defaultValue={event?.starts_at ? DateTime.fromISO(event.starts_at, { zone }).toFormat("yyyy-MM-dd'T'HH:mm") : `${event?.local_date ?? date}T09:00`} /></label>
      {kind !== "task" && <label>Ends (optional)<input type="datetime-local" name="end" defaultValue={event?.ends_at ? DateTime.fromISO(event.ends_at, { zone }).toFormat("yyyy-MM-dd'T'HH:mm") : ""} /></label>}
    </div> : <label>Date<input type="date" name="date" required defaultValue={event?.local_date ?? (event?.starts_at ? DateTime.fromISO(event.starts_at, { zone }).toISODate() ?? date : date)} /></label>}
    {(kind === "task" || kind === "custom") && <label>Submission status<select value={submission} onChange={(change) => setSubmission(change.target.value as CalendarEvent["submission"])}>
      {Object.entries(submissionLabels).map(([key, item]) => <option key={key} value={key}>{item}</option>)}
    </select></label>}
    {kind === "exam" && <>
      <label>Exam result<select value={result} onChange={(change) => setResult(change.target.value as CalendarEvent["result"])}>
        {Object.entries(resultLabels).map(([key, item]) => <option key={key} value={key}>{item}</option>)}
      </select></label>
      <fieldset><legend>Linked topics</legend>
        {data.topics.filter((topic) => !topic.archived || linked.has(topic.id)).map((topic) => <label key={topic.id} className="checkbox">
          <input name="topics" type="checkbox" value={topic.id} defaultChecked={linked.has(topic.id)} />{topic.title}{topic.archived ? " (archived)" : ""}
        </label>)}
        {!data.topics.length && <p className="muted">Add a topic to link it to this exam.</p>}
      </fieldset>
    </>}
    <label>Notes<textarea name="notes" rows={3} maxLength={3000} defaultValue={event?.notes} /></label>
    {event && <div><button type="button" className="danger" disabled={deleting} onClick={async () => {
      if (!window.confirm("Delete this calendar event?")) return;
      setDeleting(true);
      try { await save({ action: "deleteEvent", id: event.id }); close(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete event."); }
      finally { setDeleting(false); }
    }}>Delete event</button></div>}
    {error && <p className="error">{error}</p>}
  </DataForm>;
}
