import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts'))
    .filter(p => !p.data.draft)
    .sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime())
    .slice(0, 20);

  return rss({
    title: 'Cerita Basim',
    description: 'Karya, cerita, & pembaca — tulisan panjang dari Basim.',
    site: context.site!,
    items: posts.map(post => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishedAt,
      link: `/cerita/${post.slug}/`,
    })),
    customData: '<language>id</language>',
  });
}
