'use strict';
module.exports = {
  async up(q) {
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query(`ALTER TABLE support_cases ALTER COLUMN created_by_admin_user_id DROP NOT NULL, ALTER COLUMN updated_by_admin_user_id DROP NOT NULL;
        CREATE TABLE support_conversations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL UNIQUE REFERENCES support_cases(id) ON DELETE RESTRICT,
          requester_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,source varchar(32) NOT NULL CHECK(source IN ('customer','business','account_access')),
          contact_name varchar(120),contact_email varchar(320),contact_verified boolean NOT NULL DEFAULT false,
          recovery_token_hash char(64),request_key uuid NOT NULL,request_hash char(64) NOT NULL,
          abuse_key char(64) NOT NULL,last_message_at timestamptz NOT NULL,last_message_preview varchar(200) NOT NULL,
          public_context jsonb NOT NULL,
          created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
          CHECK ((source='account_access' AND requester_user_id IS NULL AND recovery_token_hash IS NOT NULL AND contact_verified=false)
            OR (source IN ('customer','business') AND requester_user_id IS NOT NULL AND recovery_token_hash IS NULL)),
          UNIQUE(abuse_key,request_key));
        CREATE TABLE support_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE RESTRICT,
          sender_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,sender_side varchar(16) NOT NULL CHECK(sender_side IN ('admin','requester')),
          body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),retry_scope varchar(100) NOT NULL,idempotency_key uuid NOT NULL,
          created_at timestamptz NOT NULL,UNIQUE(retry_scope,idempotency_key));
        CREATE TABLE support_message_reads (
          conversation_id uuid NOT NULL REFERENCES support_conversations(id) ON DELETE RESTRICT,reader_key varchar(100) NOT NULL,
          last_read_at timestamptz NOT NULL,PRIMARY KEY(conversation_id,reader_key));
        CREATE INDEX support_conversations_requester ON support_conversations(requester_user_id,last_message_at DESC,id);
        CREATE UNIQUE INDEX support_conversations_user_retry ON support_conversations(requester_user_id,request_key) WHERE requester_user_id IS NOT NULL;
        CREATE UNIQUE INDEX support_conversations_guest_retry ON support_conversations(recovery_token_hash) WHERE recovery_token_hash IS NOT NULL;
        CREATE INDEX support_conversations_abuse ON support_conversations(abuse_key,created_at);
        CREATE INDEX support_messages_conversation ON support_messages(conversation_id,created_at DESC,id);`,{ transaction });
    });
  },
  async down(q) { await q.sequelize.query('DROP TABLE support_message_reads; DROP TABLE support_messages; DROP TABLE support_conversations;'); },
};
