create table if not exists profiles (
  id uuid primary key,
  email text unique not null,
  created_at timestamptz default now()
);

create table if not exists transactions (
  id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  category text not null,
  merchant text,
  date date not null,
  note text,
  input_mode text not null check (input_mode in ('text', 'voice', 'image')),
  raw_input text,
  created_at timestamptz default now()
);

create table if not exists receipt_images (
  id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete set null,
  storage_path text not null,
  ocr_text text,
  created_at timestamptz default now()
);
