import { pgTable, text, timestamp, boolean, json, varchar, integer, uuid } from 'drizzle-orm/pg-core';
import { generateId } from 'ai';
import { InferSelectModel } from 'drizzle-orm';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const chat = pgTable('chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: text('userId')
    .notNull()
    .references(() => user.id),
  title: text('title').notNull().default('New Chat'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
});

export const message = pgTable('message', {
  id: text('id')
    .primaryKey()
    .notNull()
    .$defaultFn(() => generateId()),
  chatId: text('chat_id')
    .notNull()
    .references(() => chat.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user, assistant, or tool
  parts: json('parts').notNull(), // Store parts as JSON in the database
  attachments: json('attachments').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const stream = pgTable('stream', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => generateId()),
  chatId: text('chatId')
    .notNull()
    .references(() => chat.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

// Robokassa subscription table for recurring payments
export const subscription = pgTable('subscription', {
  id: text('id').primaryKey(), // Robokassa subscription ID
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  
  // Robokassa specific fields
  merchantLogin: text('merchantLogin').notNull(), // Merchant identifier
  recurringId: text('recurringId'), // Robokassa recurring payment ID
  subscriptionId: text('subscriptionId'), // Internal subscription identifier
  
  // Subscription details
  planType: text('planType').notNull(), // 'pro', 'ultra'
  amount: integer('amount').notNull(), // Amount in kopecks
  currency: text('currency').notNull().default('RUB'),
  recurringInterval: text('recurringInterval').notNull(), // 'monthly', 'yearly'
  
  // Status and dates
  status: text('status').notNull(), // 'active', 'canceled', 'expired', 'pending'
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  startedAt: timestamp('startedAt').notNull(),
  currentPeriodStart: timestamp('currentPeriodStart').notNull(),
  currentPeriodEnd: timestamp('currentPeriodEnd').notNull(),
  
  // Cancellation
  cancelAtPeriodEnd: boolean('cancelAtPeriodEnd').notNull().default(false),
  canceledAt: timestamp('canceledAt'),
  cancelReason: text('cancelReason'),
  
  // Robokassa metadata
  lastPaymentId: text('lastPaymentId'), // Last successful payment ID
  nextPaymentDate: timestamp('nextPaymentDate'),
  failedPaymentsCount: integer('failedPaymentsCount').notNull().default(0),
  
  // Additional data
  metadata: json('metadata'), // Additional subscription data
});

// Extreme search usage tracking table
export const extremeSearchUsage = pgTable('extreme_search_usage', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => generateId()),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  searchCount: integer('search_count').notNull().default(0),
  date: timestamp('date').notNull().defaultNow(),
  resetAt: timestamp('reset_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Message usage tracking table
export const messageUsage = pgTable('message_usage', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => generateId()),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  messageCount: integer('message_count').notNull().default(0),
  date: timestamp('date').notNull().defaultNow(),
  resetAt: timestamp('reset_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Custom instructions table
export const customInstructions = pgTable('custom_instructions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => generateId()),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Robokassa payment table for transaction tracking
export const payment = pgTable('payment', {
  id: text('id').primaryKey(), // Robokassa invoice ID
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  subscriptionId: text('subscriptionId').references(() => subscription.id),
  
  // Robokassa specific fields
  merchantLogin: text('merchantLogin').notNull(), // Merchant identifier
  invoiceId: text('invoiceId').notNull(), // Robokassa invoice ID
  signatureValue: text('signatureValue'), // Payment signature
  
  // Payment details
  amount: integer('amount').notNull(), // Amount in kopecks
  currency: text('currency').notNull().default('RUB'),
  description: text('description'), // Payment description
  
  // Payment status and type
  status: text('status').notNull(), // 'pending', 'success', 'failed', 'canceled'
  paymentType: text('paymentType').notNull(), // 'one_time', 'recurring', 'subscription'
  paymentMethod: text('paymentMethod'), // Card, SBP, etc.
  
  // Timestamps
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  paidAt: timestamp('paidAt'), // When payment was completed
  
  // Robokassa response data
  robokassaData: json('robokassaData'), // Full Robokassa response
  
  // Error handling
  errorCode: text('errorCode'),
  errorMessage: text('errorMessage'),
  
  // Additional metadata
  metadata: json('metadata'), // Custom payment metadata
});

// Lookout table for scheduled searches
export const lookout = pgTable('lookout', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => generateId()),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  frequency: text('frequency').notNull(), // 'once', 'daily', 'weekly', 'monthly', 'yearly'
  cronSchedule: text('cron_schedule').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  nextRunAt: timestamp('next_run_at').notNull(),
  qstashScheduleId: text('qstash_schedule_id'),
  status: text('status').notNull().default('active'), // 'active', 'paused', 'archived', 'running'
  lastRunAt: timestamp('last_run_at'),
  lastRunChatId: text('last_run_chat_id'),
  // Store all run history as JSON
  runHistory: json('run_history')
    .$type<
      Array<{
        runAt: string; // ISO date string
        chatId: string;
        status: 'success' | 'error' | 'timeout';
        error?: string;
        duration?: number; // milliseconds
        tokensUsed?: number;
        searchesPerformed?: number;
      }>
    >()
    .default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;
export type Session = InferSelectModel<typeof session>;
export type Account = InferSelectModel<typeof account>;
export type Verification = InferSelectModel<typeof verification>;
export type Chat = InferSelectModel<typeof chat>;
export type Message = InferSelectModel<typeof message>;
export type Stream = InferSelectModel<typeof stream>;
export type Subscription = InferSelectModel<typeof subscription>;
export type Payment = InferSelectModel<typeof payment>;
export type ExtremeSearchUsage = InferSelectModel<typeof extremeSearchUsage>;
export type MessageUsage = InferSelectModel<typeof messageUsage>;
export type CustomInstructions = InferSelectModel<typeof customInstructions>;
export type Lookout = InferSelectModel<typeof lookout>;
