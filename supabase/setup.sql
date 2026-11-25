-- Run ONLY inside a NEW dedicated BirdCam Supabase project.
-- Do not run against the existing SpesaFacile project.
-- Email/password authentication must be enabled. Consider disabling open signups
-- after creating the single intended account.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('birdcam-photos','birdcam-photos',false,10485760,array['image/jpeg'])
on conflict (id) do update
  set public=false, file_size_limit=10485760, allowed_mime_types=array['image/jpeg'];

create policy "birdcam_owner_read" on storage.objects
for select to authenticated
using (bucket_id='birdcam-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);

create policy "birdcam_owner_insert" on storage.objects
for insert to authenticated
with check (bucket_id='birdcam-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- No UPDATE or DELETE granted to clients by default.
-- The bucket is PRIVATE: do not enable public read access.
