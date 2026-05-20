import { getCollection } from 'astro:content';
import { getDB, queryAll } from '@/lib/db';

export interface PostListItem {
  slug: string;
  title: string;
  description: string;
  publishedAt: Date;
  tags: string[];
  href: string;
  source: 'content' | 'db';
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((tag): tag is string => typeof tag === 'string');
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return raw.split(',').map(tag => tag.trim()).filter(Boolean);
  }
}

export async function getContentPostList(): Promise<PostListItem[]> {
  const posts = await getCollection('posts');
  return posts
    .filter(post => !post.data.draft)
    .map(post => ({
      slug: post.slug,
      title: post.data.title,
      description: post.data.description,
      publishedAt: post.data.publishedAt,
      tags: post.data.tags,
      href: `/cerita/${post.slug}`,
      source: 'content' as const,
    }));
}

export async function getDbPostList(locals: App.Locals, limit = 20): Promise<PostListItem[]> {
  try {
    const db = getDB(locals);
    const rows = await queryAll<{
      slug: string;
      title: string;
      description: string;
      tags: string | null;
      published_at: number | null;
      created_at: number;
    }>(
      db,
      `SELECT slug, title, description, tags, published_at, created_at
       FROM posts
       WHERE status = 'published'
       ORDER BY COALESCE(published_at, created_at) DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map(row => ({
      slug: row.slug,
      title: row.title,
      description: row.description,
      publishedAt: new Date(row.published_at ?? row.created_at),
      tags: parseTags(row.tags),
      href: `/cerita/d/${row.slug}`,
      source: 'db' as const,
    }));
  } catch (error) {
    console.warn('Failed to load DB posts for list page', error);
    return [];
  }
}

export async function getAllPostList(locals: App.Locals, dbLimit = 20): Promise<PostListItem[]> {
  const [contentPosts, dbPosts] = await Promise.all([
    getContentPostList(),
    getDbPostList(locals, dbLimit),
  ]);

  return [...contentPosts, ...dbPosts]
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
