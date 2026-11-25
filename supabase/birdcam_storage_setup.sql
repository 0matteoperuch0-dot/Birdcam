-- BirdCam: run ONLY on a dedicated BirdCam Supabase project.
-- No changes to SpesaFacile. The bucket is private.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('birdcam-photos', 'birdcam-photos', false, 20971520, array['image/jpeg'])
on conflict (id) do nothing;

create policy "birdcam_read_own_photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'birdcam-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "birdcam_upload_own_photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'birdcam-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and storage.extension(name) = 'jpg'
);

create policy "birdcam_delete_own_photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'birdcam-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
