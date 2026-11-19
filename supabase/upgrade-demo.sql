-- Run once in SQL Editor for an existing QA Study Planner database.
begin;

create or replace function public.load_demo()
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  zone_name text;
  today date;
  http_id uuid;
  postman_id uuid;
  exam_id uuid;
  history_id uuid;
begin
  if owner_id is null then raise exception 'Sign in'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  select coalesce((select zone from public.settings where user_id=owner_id),'Asia/Tashkent') into zone_name;
  today := (now() at time zone zone_name)::date;
  insert into public.topics(user_id,demo_key,title,content,summary,prompt,studied_at,due_on)
  values
    (owner_id,'http','HTTP status codes', E'## What to verify\n\nCheck the status, body, and headers together. A successful creation often returns **201 Created**. A request with missing credentials can receive **401**. **403** indicates the server refuses the request.', '201: created. 401: valid credentials required. 403: request refused.', 'How would you distinguish 401 and 403 in an API test?', now()-interval '1 day', today),
    (owner_id,'postman','Postman authentication', 'Compare API keys, Basic Auth, and OAuth 2.0. Check which credential belongs in each header and use an environment variable for test credentials.', 'Choose the matching auth scheme and check how credentials are sent.', 'How would you check whether Postman sent the intended authentication header?', null, null),
    (owner_id,'boundaries','Boundary value analysis', 'If a meal name must contain 1–50 characters, test 0, 1, 2, 49, 50, and 51 characters. Record the expected result for each boundary.', 'Check the boundary and its immediate neighbors.', 'Which lengths would you test for a 1–50 character field?', null, null)
  on conflict(user_id,demo_key) do nothing;
  insert into public.topics(user_id,demo_key,title,content,summary,prompt,created_at,studied_at,due_on)
  values(owner_id,'regression-history','Regression testing',
    'After a change, select tests for the affected areas and their dependencies. For a Cart total fix, check quantity changes, removals, discounts, and checkout.',
    'Regression testing checks for unintended effects in existing functionality.',
    'Which regression tests would you run after a Cart total fix?',
    ((today-3)+time '09:00') at time zone zone_name,
    ((today-3)+time '10:00') at time zone zone_name,today)
  on conflict(user_id,demo_key) do nothing returning id into history_id;
  if history_id is not null then
    insert into public.reviews(user_id,topic_id,scheduled_for,completed_at,rating,next_due)
    values
      (owner_id,history_id,today-2,((today-2)+time '10:00') at time zone zone_name,'forgot',today-1),
      (owner_id,history_id,today-1,((today-1)+time '10:00') at time zone zone_name,'forgot',today);
  end if;
  select id into http_id from public.topics where user_id=owner_id and demo_key='http';
  select id into postman_id from public.topics where user_id=owner_id and demo_key='postman';
  insert into public.quizzes(user_id,topic_id,title,demo_key,questions)
  values(owner_id,http_id,'HTTP essentials','http-quiz',
    '[{"prompt":"Which response indicates that a new resource was created?","options":["200 OK","201 Created","401 Unauthorized","404 Not Found"],"correctOptionIndex":1,"explanation":"201 Created indicates successful creation of a resource."},{"prompt":"Which status indicates missing or invalid authentication credentials?","options":["403 Forbidden","201 Created","401 Unauthorized","500 Internal Server Error"],"correctOptionIndex":2,"explanation":"401 indicates valid authentication credentials are required."}]'::jsonb)
  on conflict(user_id,demo_key) do nothing;
  insert into public.calendar_events(user_id,demo_key,title,kind,starts_at)
  values(owner_id,'web-exam','Web Services exam','exam',((today+3)+time '15:00') at time zone zone_name)
  on conflict(user_id,demo_key) do nothing returning id into exam_id;
  if exam_id is not null then
    insert into public.event_topics(user_id,event_id,topic_id) values(owner_id,exam_id,http_id),(owner_id,exam_id,postman_id);
  end if;
  insert into public.calendar_events(user_id,demo_key,title,kind,local_date,submission)
  values(owner_id,'survey','Submit Cart test survey','task',today,'pending')
  on conflict(user_id,demo_key) do nothing;
  insert into public.calendar_events(user_id,demo_key,title,kind,starts_at,ends_at)
  values(owner_id,'mentor-meeting','QA mentor check-in','meeting',
    (today+time '14:00') at time zone zone_name,(today+time '14:30') at time zone zone_name)
  on conflict(user_id,demo_key) do nothing;
  insert into public.calendar_events(user_id,demo_key,title,kind,local_date,submission)
  values(owner_id,'submitted-report','Send bug report','task',today-1,'submitted')
  on conflict(user_id,demo_key) do nothing;
end $$;

revoke all on function public.load_demo() from public, anon;
grant execute on function public.load_demo() to authenticated;
commit;
