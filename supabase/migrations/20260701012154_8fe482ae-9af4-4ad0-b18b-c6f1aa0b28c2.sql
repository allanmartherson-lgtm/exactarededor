
-- App usa exclusivamente postgres_changes (RLS aplicada nas tabelas replicadas).
-- A policy permissiva em realtime.messages só habilita Broadcast/Presence, que
-- não são usados; removê-la fecha a possibilidade de um portal user/médico
-- se inscrever em tópicos alheios caso alguém adicione broadcast no futuro.
DROP POLICY IF EXISTS "Authenticated can use realtime" ON realtime.messages;
