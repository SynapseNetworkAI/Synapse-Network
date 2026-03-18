This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
yarn install
yarn dev
```

Package management for `apps/frontend` is standardized on Yarn.
Do not use `npm install` or `npm ci` in this app, and do not regenerate `package-lock.json`.

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment Variables

Set these in `apps/frontend/.env.local`:

```bash
NEXT_PUBLIC_GATEWAY_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS=20000
```

- `NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS`: service list client cache TTL in milliseconds (recommend 15000-30000).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
