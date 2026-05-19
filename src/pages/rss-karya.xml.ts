import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const projects = (await getCollection('projects'))
    .sort((a, b) => b.data.year - a.data.year)
    .slice(0, 20);

  return rss({
    title: 'Cerita Basim — Karya',
    description: 'Project dan eksperimen dari Basim.',
    site: context.site!,
    items: projects.map(project => ({
      title: project.data.title,
      description: project.data.tagline,
      pubDate: new Date(project.data.year, 0, 1),
      link: `/karya/${project.slug}/`,
    })),
    customData: '<language>id</language>',
  });
}
