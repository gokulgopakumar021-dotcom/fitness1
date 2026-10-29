-- Iron Log: set the body area ("folder") of every video, so the Video Library can browse by Chest, Back, Shoulders, Arms, Legs, Core, Cardio, Stretching.
-- YOU run this by hand: Supabase Dashboard -> SQL Editor. It is NOT a migration and is never applied automatically.
--
-- What it does, in ONE all-or-nothing step: for every video whose muscle_groups is still empty, it sets
--   muscle_groups = [area] or [area, detail], decided from the video title by the keyword rules below.
--   area is one of: chest, back, shoulders, arms, legs, core, cardio, stretching   (the folders; see src/data/videoFolders.ts)
--   detail (optional) is one of: biceps, triceps, forearms, quads, hamstrings, glutes, calves, adductors, traps, lower back.
-- What it refuses (and then changes nothing): any video whose title matches none of the rules. It lists the titles.
-- What it never touches: videos that already have a muscle_groups value, and every other column (published, exercise_key, status, title, tags).
-- Re-running is harmless: it only fills videos that are still empty.
-- To change one video later:  update public.exercise_videos set muscle_groups = array['legs','glutes'] where title = '...';

do $$
declare
  unclassified int;
  names        text;
  changed      int;
begin
  create temp table _areas on commit drop as
  with
cls as (
  select id, title,
    case
      when t like 'stretching%'                                                                         then 'stretching'
      when t ~ '(cardio|elliptical|jump rope|jumping jack|burpee|stationary bike|treadmill|walk wave|battling rope)' then 'cardio'
      when t ~ '(hip raise bridge|rear decline bridge|lying hip lift|kickback bent position|standing rear kick|hip extension|pull through|hip abduction|hip adduction)' then 'legs'
      when t ~ 'chest dip'                                                                              then 'chest'
      when t ~ '(rear delt|rear lateral|reverse fly|lateral raise|front raise|forward raise|upright row|iron cross|military press|shoulder press|arnold|clean and press|anti gravity press|scapula|bench seated press)' then 'shoulders'
      when t ~ '(triceps|pushdown|kickback|dips|alternate extension)'                                   then 'arms'
      when t ~ 'wrist curl'                                                                             then 'arms'
      when t ~ '(leg curl|femoral|deadlift)'                                                            then 'legs'
      when t ~ '\mcurl'                                                                                 then 'arms'
      when t ~ '(pull-?ups?|chin-?ups?|pulldown|\mrow\M|pullover|hyperextension|back extension|reverse extension|shrug|inverted)' then 'back'
      when t ~ '(crunch|sit[- ]?ups?|plank|twist|leg raise|hip raise|v-up|jack ?knife|side bend|side bridge|scissor kick|landmine 180|spell caster|otis|chest lift with rotation|pilates|standing lift)' then 'core'
      when t ~ '(bench press|push[- ]?ups?|fly|chest press|pec deck|crossover|hammer press|close grip press)' then 'chest'
      when t ~ '(squat|lunge|leg press|leg extension|calf|step-up|sled|hack)'                           then 'legs'
    end as area,
    case
      when t like 'stretching%' or t ~ '(cardio|elliptical|jump rope|jumping jack|burpee|stationary bike|treadmill|walk wave|battling rope)' then null
      when t ~ 'hip adduction'                                                                          then 'adductors'
      when t ~ '(hip raise bridge|rear decline bridge|lying hip lift|kickback bent position|standing rear kick|hip extension|pull through|hip abduction)' then 'glutes'
      when t ~ 'chest dip'                                                                              then null
      when t ~ '(rear delt|rear lateral|reverse fly|lateral raise|front raise|forward raise|upright row|iron cross|military press|shoulder press|arnold|clean and press|anti gravity press|scapula|bench seated press)' then null
      when t ~ '(triceps|pushdown|kickback|dips|alternate extension)'                                   then 'triceps'
      when t ~ 'wrist curl'                                                                             then 'forearms'
      when t ~ '(leg curl|femoral|deadlift)'                                                            then 'hamstrings'
      when t ~ '\mcurl'                                                                                 then 'biceps'
      when t ~ 'shrug'                                                                                  then 'traps'
      when t ~ '(hyperextension|back extension|reverse extension)'                                      then 'lower back'
      when t ~ '(pull-?ups?|chin-?ups?|pulldown|\mrow\M|pullover|inverted)'                             then null
      when t ~ '(crunch|sit[- ]?ups?|plank|twist|leg raise|hip raise|v-up|jack ?knife|side bend|side bridge|scissor kick|landmine 180|spell caster|otis|chest lift with rotation|pilates|standing lift)' then null
      when t ~ '(bench press|push[- ]?ups?|fly|chest press|pec deck|crossover|hammer press|close grip press)' then null
      when t ~ 'calf'                                                                                   then 'calves'
      when t ~ '(squat|lunge|leg press|leg extension|step-up|sled|hack)'                                then 'quads'
    end as sub
  from (select id, title, lower(title) as t from public.exercise_videos) x
)
  select c.id, c.title, c.area, c.sub
  from cls c join public.exercise_videos v on v.id = c.id
  where coalesce(cardinality(v.muscle_groups), 0) = 0;

  select count(*), string_agg(title, '; ' order by title) into unclassified, names from _areas where area is null;
  if unclassified > 0 then
    raise exception 'Nothing changed: % video(s) match no body-area rule: %', unclassified, names;
  end if;

  update public.exercise_videos v
  set muscle_groups = case when a.sub is null then array[a.area] else array[a.area, a.sub] end
  from _areas a
  where v.id = a.id;
  get diagnostics changed = row_count;
  raise notice 'Set the body area of % video(s).', changed;
end
$$;

-- Check the result (run after the block above): videos per folder.
select coalesce(muscle_groups[1], '(none)') as folder, count(*) as videos
from public.exercise_videos group by 1 order by 1;
