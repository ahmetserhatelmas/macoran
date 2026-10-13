-- Adminin akış ve sıralama için açtığı vitrin hesapları. Gerçek üyelere uygulanmaz.

alter table public.profiles
  add column if not exists is_showcase boolean not null default false;
