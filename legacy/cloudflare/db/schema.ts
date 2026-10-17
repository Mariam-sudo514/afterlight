import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(), slug: text('slug').notNull(),
  category: text('category').notNull(), status: text('status').notNull(),
  cover: text('cover').notNull(), coverKind: text('cover_kind').notNull(),
  ru: text('ru').notNull(), en: text('en').notNull(), version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), publishedAt: text('published_at'),
}, table => [uniqueIndex('idx_posts_slug').on(table.slug), index('idx_posts_status_published').on(table.status, table.publishedAt)]);

export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });
export const media = sqliteTable('media', {
  key: text('key').primaryKey(), contentType: text('content_type').notNull(),
  size: integer('size').notNull(), ownerId: text('owner_id').notNull(), createdAt: text('created_at').notNull(),
});
