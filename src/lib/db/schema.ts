import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  real,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

// ── pgvector custom type ──────────────────────────────────────────────────────
const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) {
    const dims = (config as { dimensions?: number })?.dimensions ?? 1024;
    return `vector(${dims})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

// ── users ─────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  googleId: varchar("google_id", { length: 255 }).unique(),
  name: varchar("name", { length: 255 }),
  avatarUrl: text("avatar_url"),
  preferences: jsonb("preferences")
    .$type<{
      theme: "dark" | "light";
      density: "compact" | "comfortable";
      snoozeDefaultMinutes: number;
      sendUndoSeconds: number;
      briefMinutesBefore: number;
    }>()
    .default({
      theme: "dark",
      density: "comfortable",
      snoozeDefaultMinutes: 60,
      sendUndoSeconds: 10,
      briefMinutesBefore: 5,
    }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── corsair_connections ───────────────────────────────────────────────────────
// Hosted Corsair stores OAuth tokens server-side; we only track connection state
// per provider. Tenant id == users.id, so no token/connection-id columns here.
export const corsairConnections = pgTable(
  "corsair_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 20 }).notNull(), // 'gmail' | 'googlecalendar'
    connectedEmail: varchar("connected_email", { length: 255 }),
    status: varchar("status", { length: 20 }).default("connected").notNull(), // connected | needs_auth
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.provider)]
);

// ── email_threads ─────────────────────────────────────────────────────────────
export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gmailThreadId: varchar("gmail_thread_id", { length: 255 }).notNull(),
    subject: text("subject"),
    snippet: varchar("snippet", { length: 300 }),
    participantEmails: text("participant_emails").array().default([]),
    messageCount: integer("message_count").default(1).notNull(),
    isRead: boolean("is_read").default(false).notNull(),
    isStarred: boolean("is_starred").default(false).notNull(),
    isArchived: boolean("is_archived").default(false).notNull(),
    isTrashed: boolean("is_trashed").default(false).notNull(),
    isSnoozed: boolean("is_snoozed").default(false).notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    gmailLabels: text("gmail_labels").array().default([]),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.gmailThreadId)]
);

// ── emails ────────────────────────────────────────────────────────────────────
export const emails = pgTable("emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => emailThreads.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  gmailMessageId: varchar("gmail_message_id", { length: 255 }).notNull().unique(),
  fromEmail: varchar("from_email", { length: 255 }),
  fromName: varchar("from_name", { length: 255 }),
  toEmails: text("to_emails").array().default([]),
  ccEmails: text("cc_emails").array().default([]),
  bccEmails: text("bcc_emails").array().default([]),
  replyTo: varchar("reply_to", { length: 255 }),
  subject: text("subject"),
  bodyText: text("body_text"),
  bodySnippet: varchar("body_snippet", { length: 500 }),
  bodyHtml: text("body_html"),
  gmailLabels: text("gmail_labels").array().default([]),
  isSent: boolean("is_sent").default(false).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── email_attachments ─────────────────────────────────────────────────────────
export const emailAttachments = pgTable("email_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  emailId: uuid("email_id")
    .notNull()
    .references(() => emails.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 500 }),
  mimeType: varchar("mime_type", { length: 100 }),
  sizeBytes: integer("size_bytes"),
  url: text("url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── llm_classifications ───────────────────────────────────────────────────────
export const llmClassifications = pgTable("llm_classifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  emailId: uuid("email_id")
    .notNull()
    .unique()
    .references(() => emails.id, { onDelete: "cascade" }),
  priority: varchar("priority", { length: 10 }).notNull().default("normal"), // urgent|high|normal|low
  priorityScore: real("priority_score"),
  tags: text("tags").array().default([]),
  summary: text("summary"),
  confidence: real("confidence"),
  modelUsed: varchar("model_used", { length: 50 }),
  promptTokens: integer("prompt_tokens"),
  classifiedAt: timestamp("classified_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── action_items ──────────────────────────────────────────────────────────────
export const actionItems = pgTable("action_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  emailId: uuid("email_id").references(() => emails.id, { onDelete: "set null" }),
  threadId: uuid("thread_id").references(() => emailThreads.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  isDone: boolean("is_done").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── email_vectors ─────────────────────────────────────────────────────────────
export const emailVectors = pgTable("email_vectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  emailId: uuid("email_id")
    .notNull()
    .references(() => emails.id, { onDelete: "cascade" }),
  chunkText: text("chunk_text"),
  embedding: vector("embedding", { dimensions: 1024 } as { dimensions: number }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── email_drafts ──────────────────────────────────────────────────────────────
export const emailDrafts = pgTable("email_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  threadId: varchar("thread_id", { length: 255 }), // nullable: null = new thread
  toEmails: text("to_emails").array().default([]),
  ccEmails: text("cc_emails").array().default([]),
  bccEmails: text("bcc_emails").array().default([]),
  subject: text("subject"),
  body: text("body"),
  aiSuggestions: jsonb("ai_suggestions")
    .$type<{
      subjectAlternatives: string[];
      tone: string;
      lengthFeedback: string;
      completions: string[];
    }>()
    .default({
      subjectAlternatives: [],
      tone: "professional",
      lengthFeedback: "",
      completions: [],
    }),
  isScheduled: boolean("is_scheduled").default(false).notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── contacts ──────────────────────────────────────────────────────────────────
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    isVip: boolean("is_vip").default(false).notNull(),
    emailCount: integer("email_count").default(0).notNull(),
    lastEmailedAt: timestamp("last_emailed_at", { withTimezone: true }),
    avgReplyHours: real("avg_reply_hours"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.email)]
);

// ── calendars ─────────────────────────────────────────────────────────────────
export const calendars = pgTable("calendars", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  googleCalId: varchar("google_cal_id", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  description: text("description"),
  colorHex: varchar("color_hex", { length: 7 }),
  timezone: varchar("timezone", { length: 100 }),
  isPrimary: boolean("is_primary").default(false).notNull(),
  isReadonly: boolean("is_readonly").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── calendar_events ───────────────────────────────────────────────────────────
export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  calendarId: uuid("calendar_id")
    .notNull()
    .references(() => calendars.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  googleEventId: varchar("google_event_id", { length: 255 }).notNull().unique(),
  title: varchar("title", { length: 500 }),
  description: text("description"),
  location: varchar("location", { length: 500 }),
  startTime: timestamp("start_time", { withTimezone: true }),
  endTime: timestamp("end_time", { withTimezone: true }),
  isAllDay: boolean("is_all_day").default(false).notNull(),
  status: varchar("status", { length: 20 }).default("confirmed").notNull(), // confirmed|tentative|cancelled
  visibility: varchar("visibility", { length: 20 }).default("public").notNull(),
  organizerEmail: varchar("organizer_email", { length: 255 }),
  meetingLink: text("meeting_link"),
  conferenceData: jsonb("conference_data").$type<Record<string, unknown>>().default({}),
  recurrenceRules: text("recurrence_rules").array().default([]),
  relatedEmailThreadId: uuid("related_email_thread_id").references(() => emailThreads.id, {
    onDelete: "set null",
  }),
  aiBrief: text("ai_brief"),
  briefGeneratedAt: timestamp("brief_generated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── calendar_event_attendees ──────────────────────────────────────────────────
export const calendarEventAttendees = pgTable("calendar_event_attendees", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => calendarEvents.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }),
  rsvpStatus: varchar("rsvp_status", { length: 20 }).default("needsAction").notNull(),
  isOrganizer: boolean("is_organizer").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── keyboard_shortcuts ────────────────────────────────────────────────────────
export const keyboardShortcuts = pgTable(
  "keyboard_shortcuts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 100 }).notNull(),
    shortcutKey: varchar("shortcut_key", { length: 50 }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.action)]
);

// ── search_logs ───────────────────────────────────────────────────────────────
export const searchLogs = pgTable("search_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  queryEmbedding: vector("query_embedding", { dimensions: 1024 } as { dimensions: number }),
  resultCount: integer("result_count"),
  executionTimeMs: integer("execution_time_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── webhook_events ────────────────────────────────────────────────────────────
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: varchar("source", { length: 10 }).notNull(), // 'gmail' | 'gcal'
  eventType: varchar("event_type", { length: 50 }).notNull(),
  resourceId: varchar("resource_id", { length: 255 }),
  rawPayload: jsonb("raw_payload"),
  processed: boolean("processed").default(false).notNull(),
  errorMsg: text("error_msg"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── agent_conversations ───────────────────────────────────────────────────────
export const agentConversations = pgTable("agent_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  messages: jsonb("messages")
    .$type<
      Array<{
        role: "user" | "assistant";
        content: unknown;
      }>
    >()
    .default([]),
  actionsTaken: text("actions_taken").array().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  connections: many(corsairConnections),
  threads: many(emailThreads),
  calendars: many(calendars),
  drafts: many(emailDrafts),
  contacts: many(contacts),
  shortcuts: many(keyboardShortcuts),
  actionItems: many(actionItems),
  agentConversations: many(agentConversations),
}));

export const emailThreadsRelations = relations(emailThreads, ({ one, many }) => ({
  user: one(users, { fields: [emailThreads.userId], references: [users.id] }),
  emails: many(emails),
}));

export const emailsRelations = relations(emails, ({ one, many }) => ({
  thread: one(emailThreads, { fields: [emails.threadId], references: [emailThreads.id] }),
  user: one(users, { fields: [emails.userId], references: [users.id] }),
  attachments: many(emailAttachments),
  classification: one(llmClassifications, {
    fields: [emails.id],
    references: [llmClassifications.emailId],
  }),
  vectors: many(emailVectors),
  actionItems: many(actionItems),
}));

export const calendarsRelations = relations(calendars, ({ one, many }) => ({
  user: one(users, { fields: [calendars.userId], references: [users.id] }),
  events: many(calendarEvents),
}));

export const calendarEventsRelations = relations(calendarEvents, ({ one, many }) => ({
  calendar: one(calendars, { fields: [calendarEvents.calendarId], references: [calendars.id] }),
  user: one(users, { fields: [calendarEvents.userId], references: [users.id] }),
  attendees: many(calendarEventAttendees),
}));

// ── Type exports ──────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type CorsairConnection = typeof corsairConnections.$inferSelect;
export type EmailThread = typeof emailThreads.$inferSelect;
export type Email = typeof emails.$inferSelect;
export type EmailAttachment = typeof emailAttachments.$inferSelect;
export type LlmClassification = typeof llmClassifications.$inferSelect;
export type ActionItem = typeof actionItems.$inferSelect;
export type EmailDraft = typeof emailDrafts.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Calendar = typeof calendars.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type CalendarEventAttendee = typeof calendarEventAttendees.$inferSelect;
export type KeyboardShortcut = typeof keyboardShortcuts.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type AgentConversation = typeof agentConversations.$inferSelect;
