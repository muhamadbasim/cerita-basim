/// <reference types="astro/client" />

type D1Database = import('@cloudflare/workers-types').D1Database;
type KVNamespace = import('@cloudflare/workers-types').KVNamespace;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;

type Runtime = import('@astrojs/cloudflare').Runtime<{
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  SITE_URL: string;
  TURNSTILE_SECRET: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  ADMIN_EMAIL: string;
  ENCRYPTION_KEY: string;
  ENCRYPTION_SALT: string;
}>;

declare namespace App {
  interface Locals extends Runtime {}
}
