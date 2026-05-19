import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    tags: z.array(z.string()),
    cover: z.string().optional(),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    tagline: z.string(),
    category: z.enum(['web', 'mobile', 'tools', 'experiment']),
    year: z.number(),
    cover: z.string().optional(),
    coverColor: z.enum(['terra', 'forest', 'gold', 'ink', 'mix', 'sand']).default('terra'),
    stack: z.array(z.string()),
    role: z.string(),
    duration: z.string().optional(),
    status: z.enum(['live', 'discontinued', 'beta', 'archived']).default('live'),
    demoUrl: z.string().url().optional(),
    repoUrl: z.string().url().optional(),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

export const collections = { posts, projects };
