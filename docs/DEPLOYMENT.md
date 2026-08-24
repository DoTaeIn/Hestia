# Hestia deployment

Hestia runs as a Next.js application on Vercel with Supabase for authentication and PostgreSQL.

## 1. Supabase

1. Create a Supabase project.
2. Open the SQL Editor and run `supabase/migrations/0001_auth_workspaces.sql` through `supabase/migrations/0009_page_images.sql` in order.
3. In **Authentication > Providers**, enable Email and Google.
4. Add these redirect URLs under **Authentication > URL Configuration**:
   - `http://localhost:3000/auth/callback`
   - `https://YOUR_DOMAIN/auth/callback`

## 2. Environment variables

Copy `.env.example` to `.env.local` for local development. In Vercel, add the same two variables in Project Settings > Environment Variables.

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Never expose a Supabase service-role key in Next.js client variables.

## 3. Deploy

Connect the repository to Vercel, add the variables, then deploy. The middleware protects the space, editor, search, and onboarding routes; unauthenticated visitors are sent to `/login`.

After the first deployment, replace `YOUR_DOMAIN` in Supabase with the deployed Vercel domain before testing magic links or Google OAuth.
