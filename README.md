# QA Study Planner

A personal QA training app for deciding what to study today, preparing for exams, and reviewing material on a schedule. It includes Authentication, Calendar, Topics, Tests, Today, Review, and Dashboard.

## Project structure

| Path | Purpose |
|---|---|
| `app/page.tsx`, `app/layout.tsx`, `app/style.css` | Next.js entry point, layout, and styling |
| `app/(workspace)/`, `lib/sections.ts` | Workspace routes and sidebar page definitions |
| `app/workspace.tsx` | Authentication, navigation, Today, review, and dashboard |
| `app/calendar.tsx` | FullCalendar, tasks and exam statuses, filters, and event editor |
| `app/content.tsx` | Topic and quiz editors, import screens, and quiz attempts |
| `app/api/workspace/route.ts` | Authenticated requests, server validation, and database calls |
| `lib/imports.ts` | Zod schemas, strict JSON parser, AI prompts, and downloadable examples |
| `lib/model.ts` | Dates, priority queues, streak, and weak-topic rules |
| `supabase/schema.sql` | Tables, constraints, row-level security, and transactional functions |
| `supabase/upgrade-demo.sql`, `supabase/seed-demo.sql` | Demo update for existing databases and optional manual seeding |
| `.env.example` | Required environment variables |

## 1. Configure Supabase Free

1. Create a free project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Open **SQL Editor → New query**. Paste the full contents of `supabase/schema.sql` and run it once against the new project. The script creates the tables and policies in a transaction.
3. In **Authentication → Sign In / Providers → Email**, enable the email provider, allow signups, and turn off **Confirm email**. Set the minimum password length to **8** to match the registration form. Users can register with any syntactically valid email address. This project uses no email delivery.
4. From the project's **Connect** dialog or **Settings → API Keys**, copy the project URL and **publishable** key (starts with `sb_publishable_`). The app requires only the public-facing key.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL, e.g. `https://your-project.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |

## 2. Run locally

Use Node.js 22 and npm. Run these commands inside the extracted `qa-study-planner` folder:

```sh
cp .env.example .env.local
npm ci
npm run dev
```

Fill in both values in `.env.local` before starting, or restart the server after editing it. Open [http://localhost:3000](http://localhost:3000), create an account, and select **Load demo data**. Use `npm run typecheck` and `npm run build` to check the project.

## 3. Deploy to Vercel Hobby

1. Push the application to a Git repository. `.env.local` is ignored. The repository root should contain `package.json`, or set Vercel's Root Directory to the application folder.
2. In Vercel, select **Add New → Project**, import the repository, and use the **Next.js** framework preset and Node.js 22.
3. Add both variables above under **Environment Variables** for Production. Add them for Preview as well if you want preview builds to work. Deploy. After changing these variables, redeploy so Next.js includes them in the client build.
4. Open the production URL in a private window. Create a test account, load demo data, and verify the calendar and review workflow. Share the production URL with your mentor, who can register and load their own demo data. If Supabase has paused the free project, restore it from its dashboard and recheck the application first.

The frontend and server routes run on Vercel. Auth and PostgreSQL run on Supabase. A separate Node server or database process is unnecessary.

## Demo data

If you already ran `schema.sql` for an earlier version, run `supabase/upgrade-demo.sql` in Supabase **SQL Editor** to update the demo loader. For a new database, the current `schema.sql` already includes it.

Click **Load demo data** while signed in, or open `supabase/seed-demo.sql` in SQL Editor, replace the example email with the address you signed up with, and run the whole script. Both methods load the same records for that account. Repeat runs preserve existing progress and skip demo records that are already present.

The seed creates four topics (HTTP status codes, Postman authentication, Boundary value analysis, and Regression testing), an HTTP quiz, and four calendar events (a pending task, a submitted task, a meeting, and an upcoming exam). Regression testing has a first study session and two **Forgot** reviews over the three days before seeding, so it appears under **Weak topics** with at least a three-day streak visible on Dashboard. If you already have activity, your streak can be longer.

## Demo walkthrough

1. Click **Load demo data**. Today shows a new Postman topic, the due HTTP status codes review, and a sample task.
2. Open the due **HTTP status codes** review, reveal the summary, and choose **Forgot**. The next review moves to tomorrow, and Dashboard records a completed review and a streak day.
3. Open **Calendar**, change the Web Services exam result to **Passed** or **Not passed**, and mark the Cart test survey **Submitted**. Exam result badges are blue or magenta. Task submissions use amber or green.
4. In **Tests**, submit the HTTP quiz. Dashboard updates the topic's quiz accuracy. For an import demo, open either import form, download its example, and preview it before saving.

FullCalendar v6 provides Month, Week, and Agenda views with a React component and TypeScript support. The Luxon plugin displays timed events in the account's IANA time zone. Date-only deadlines stay on the date chosen.

Topic and quiz imports accept one UTF-8 JSON object per file. The exact v1 fields and limits are defined in `lib/imports.ts`. Each import screen shows a copyable AI prompt and a downloadable example. The quiz import asks the user to select an active topic. The server revalidates the raw JSON before saving.

Review intervals are 1, 3, 7, 14, and 30 days. Remembered advances one step, while Forgot schedules tomorrow. A streak day requires a first study completion, a scheduled review completion, or a submitted quiz. A topic is weak when at least two of its last three reviews were Forgot, or both of its last two quiz attempts scored below 70%.

## Troubleshooting

- **Signup does not start a session** — check that email signup is enabled and **Confirm email** is off.
- **Workspace cannot load after login** — check that the SQL ran against the same Supabase project configured in your environment variables.
- **It works locally but fails on Vercel** — confirm the variables are set for the deployment's environment, then redeploy.
