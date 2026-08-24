insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('page-images', 'page-images', false, 20971520, array['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = excluded.allowed_mime_types;

create policy "Workspace members can read page images" on storage.objects for select to authenticated
using (bucket_id = 'page-images' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

create policy "Editors can upload page images" on storage.objects for insert to authenticated
with check (bucket_id = 'page-images' and public.can_edit_workspace((storage.foldername(name))[1]::uuid));

create policy "Editors can delete page images" on storage.objects for delete to authenticated
using (bucket_id = 'page-images' and public.can_edit_workspace((storage.foldername(name))[1]::uuid));
