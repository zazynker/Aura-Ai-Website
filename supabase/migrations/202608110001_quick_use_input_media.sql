-- Quick Use candidates may expose image, video, or audio user_upload slots.
-- Keep these private inputs in the existing owner-scoped user-uploads bucket;
-- generated results continue to use the public generations bucket.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/avif',
      'video/mp4','video/webm','video/quicktime',
      'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg',
      'audio/mp4','audio/x-m4a'
    ]
where id = 'user-uploads';
