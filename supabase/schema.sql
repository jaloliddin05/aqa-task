begin;
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  zone text not null default 'Asia/Tashkent',
  new_limit integer not null default 2 check (new_limit between 1 and 30),
  review_limit integer not null default 5 check (review_limit between 1 and 50)
);
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (length(title) between 1 and 120),
  content text not null check (length(content) between 1 and 30000),
  summary text not null check (length(summary) between 1 and 2000),
  prompt text not null check (length(prompt) between 1 and 300),
  created_at timestamptz not null default now(),
  studied_at timestamptz,
  due_on date,
  step integer not null default 0 check (step between 0 and 4),
  archived boolean not null default false,
  demo_key text,
  unique (user_id, demo_key),
  unique (user_id, id),
  check ((studied_at is null) = (due_on is null))
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  topic_id uuid not null,
  scheduled_for date not null,
  completed_at timestamptz not null default now(),
  rating text not null check (rating in ('remembered','forgot')),
  next_due date not null,
  unique (topic_id, scheduled_for),
  foreign key (user_id, topic_id) references public.topics(user_id,id) on delete cascade
);
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  topic_id uuid not null,
  title text not null check (length(title) between 1 and 120),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 30),
  demo_key text,
  unique (user_id,demo_key),
  unique (user_id,id,topic_id),
  foreign key (user_id,topic_id) references public.topics(user_id,id) on delete cascade
);
create table public.attempts (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  topic_id uuid not null,
  quiz_id uuid not null,
  snapshot jsonb not null,
  answers jsonb,
  correct integer,
  total integer not null check (total between 1 and 30),
  submitted_at timestamptz,
  check (correct between 0 and total),
  check ((submitted_at is null and answers is null and correct is null)
      or (submitted_at is not null and answers is not null and correct is not null)),
  foreign key (user_id,quiz_id,topic_id) references public.quizzes(user_id,id,topic_id) on delete cascade
);
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (length(title) between 1 and 120),
  kind text not null check (kind in ('task','meeting','exam','custom')),
  custom_type text check (length(custom_type) between 1 and 60),
  notes text not null default '' check (length(notes) <= 3000),
  local_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  submission text not null default 'na' check (submission in ('na','pending','submitted')),
  result text not null default 'pending' check (result in ('pending','passed','not_passed')),
  demo_key text,
  unique (user_id,demo_key),
  unique (user_id,id),
  check ((local_date is null) <> (starts_at is null)),
  check (kind not in ('meeting','exam') or starts_at is not null),
  check (ends_at is null or (kind <> 'task' and starts_at is not null and ends_at > starts_at)),
  check ((kind = 'custom') = (custom_type is not null)),
  check (kind in ('task','custom') or submission = 'na'),
  check (kind = 'exam' or result = 'pending')
);
create table public.event_topics (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  event_id uuid not null,
  topic_id uuid not null,
  primary key (event_id,topic_id),
  foreign key (user_id,event_id) references public.calendar_events(user_id,id) on delete cascade,
  foreign key (user_id,topic_id) references public.topics(user_id,id) on delete cascade
);
create index reviews_owner_date on public.reviews(user_id,completed_at);
create index attempts_owner_date on public.attempts(user_id,submitted_at);
create index events_owner on public.calendar_events(user_id);
create index topics_owner_due on public.topics(user_id,due_on);

do $$
declare table_name text;
begin
  foreach table_name in array array['settings','topics','reviews','quizzes','attempts','calendar_events','event_topics'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from anon, authenticated',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
    execute format('create policy own_rows on public.%I for select to authenticated using ((select auth.uid()) = user_id)',table_name);
  end loop;
  foreach table_name in array array['settings','quizzes','calendar_events','event_topics'] loop
    execute format('grant insert,update,delete on public.%I to authenticated',table_name);
    execute format('create policy own_writes on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',table_name);
  end loop;
end $$;
grant insert(title,content,summary,prompt), update(title,content,summary,prompt,archived) on public.topics to authenticated;
create policy insert_topic on public.topics for insert to authenticated with check (auth.uid() = user_id);
create policy update_topic on public.topics for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create function public.study_action(p_topic uuid, p_rating text default null, p_due date default null)
returns date language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  item public.topics%rowtype;
  today date;
  previous_next date;
  next_step integer;
  next_date date;
  intervals integer[] := array[1,3,7,14,30];
begin
  select (now() at time zone coalesce((select zone from public.settings where user_id = owner_id),'Asia/Tashkent'))::date into today;
  select * into item from public.topics where id = p_topic and user_id = owner_id and not archived for update;
  if not found then raise exception 'Active topic not found'; end if;
  if p_rating is null then
    if item.studied_at is not null then return item.due_on; end if;
    update public.topics set studied_at = now(), due_on = today + 1 where id = p_topic;
    return today + 1;
  end if;
  if p_rating not in ('remembered','forgot') or p_due is null then raise exception 'Invalid review'; end if;
  select next_due into previous_next from public.reviews where topic_id = p_topic and user_id = owner_id and scheduled_for = p_due;
  if found then return previous_next; end if;
  if item.due_on is distinct from p_due or p_due > today then raise exception 'This review is not due'; end if;
  next_step := case when p_rating = 'forgot' then 0 else least(item.step + 1,4) end;
  next_date := today + intervals[next_step + 1];
  insert into public.reviews(user_id,topic_id,scheduled_for,rating,next_due)
  values(owner_id,p_topic,p_due,p_rating,next_date);
  update public.topics set due_on = next_date, step = next_step where id = p_topic;
  return next_date;
end $$;

create function public.quiz_action(p_attempt uuid, p_quiz uuid default null, p_answers jsonb default null)
returns public.attempts language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  quiz public.quizzes%rowtype;
  attempt public.attempts%rowtype;
  right_count integer;
begin
  if p_answers is null then
    select q.* into quiz from public.quizzes q join public.topics t on t.id = q.topic_id
    where q.id = p_quiz and q.user_id = owner_id and not t.archived;
    if not found then raise exception 'Quiz not found'; end if;
    insert into public.attempts(id,user_id,topic_id,quiz_id,snapshot,total)
    values(p_attempt,owner_id,quiz.topic_id,quiz.id,quiz.questions,jsonb_array_length(quiz.questions))
    on conflict(id) do nothing;
  end if;
  select * into attempt from public.attempts where id = p_attempt and user_id = owner_id for update;
  if not found then raise exception 'Attempt not found'; end if;
  if p_answers is null or attempt.submitted_at is not null then return attempt; end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> attempt.total then
    raise exception 'Answer every question';
  end if;
  if exists(select 1 from jsonb_array_elements(p_answers) a(value) where value::text not in ('0','1','2','3')) then
    raise exception 'Invalid answer';
  end if;
  select count(*) into right_count from jsonb_array_elements(attempt.snapshot) with ordinality q(value,position)
  where q.value->'correctOptionIndex' = p_answers->((q.position-1)::integer);
  update public.attempts set answers = p_answers, correct = right_count, submitted_at = now()
  where id = p_attempt returning * into attempt;
  return attempt;
end $$;

create function public.save_event(p_id uuid, p_event jsonb, p_links uuid[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  item public.calendar_events%rowtype;
  saved_id uuid;
begin
  item := jsonb_populate_record(null::public.calendar_events,p_event);
  if item.kind <> 'exam' and cardinality(p_links) > 0 then raise exception 'Only exams link topics'; end if;
  if p_id is null then
    insert into public.calendar_events(title,kind,custom_type,notes,local_date,starts_at,ends_at,submission,result)
    values(item.title,item.kind,item.custom_type,item.notes,item.local_date,item.starts_at,item.ends_at,item.submission,item.result)
    returning id into saved_id;
  else
    update public.calendar_events set title=item.title,kind=item.kind,custom_type=item.custom_type,notes=item.notes,
      local_date=item.local_date,starts_at=item.starts_at,ends_at=item.ends_at,submission=item.submission,result=item.result
    where id=p_id returning id into saved_id;
    if not found then raise exception 'Event not found'; end if;
    delete from public.event_topics where event_id=saved_id;
  end if;
  insert into public.event_topics(event_id,topic_id)
  select saved_id,topic_id from unnest(p_links) as links(topic_id);
  return saved_id;
end $$;

create function public.load_demo()
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

revoke all on function public.study_action(uuid,text,date), public.quiz_action(uuid,uuid,jsonb),
  public.save_event(uuid,jsonb,uuid[]), public.load_demo() from public, anon;
grant execute on function public.study_action(uuid,text,date), public.quiz_action(uuid,uuid,jsonb),
  public.save_event(uuid,jsonb,uuid[]), public.load_demo() to authenticated;
commit;
